-- Phase 2 foundation. Apply only through a reviewed migration workflow.
-- Supabase supplies auth.users; plain PostgreSQL test fixtures supply a minimal substitute.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_api') THEN
    CREATE ROLE app_api NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_ingress') THEN
    CREATE ROLE app_ingress NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('app_api','app_ingress')
      AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolcanlogin)) THEN
    RAISE EXCEPTION 'Application capability roles must be restricted NOLOGIN roles';
  END IF;
END $$;

CREATE SCHEMA app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO app_api,app_ingress;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE FUNCTION app.actor_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog
AS $$ SELECT nullif(current_setting('app.user_id',true),'')::uuid $$;
CREATE FUNCTION app.tenant_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog
AS $$ SELECT nullif(current_setting('app.business_id',true),'')::uuid $$;
REVOKE ALL ON FUNCTION app.actor_id(),app.tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.actor_id(),app.tenant_id() TO app_api,app_ingress;

CREATE TABLE app.businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug)<=120),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  timezone text NOT NULL CHECK (length(timezone) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  version integer NOT NULL DEFAULT 1 CHECK (version>=1),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_by uuid, deleted_at timestamptz
);
CREATE INDEX businesses_status_idx ON app.businesses(status) WHERE deleted_at IS NULL;

CREATE TABLE app.business_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('owner','manager','operator')),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version>=1),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_by uuid,
  UNIQUE(business_id,id), UNIQUE(business_id,user_id)
);
CREATE INDEX memberships_user_active_idx ON app.business_memberships(user_id,active,business_id);

CREATE TABLE app.whatsapp_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,
  phone_number_id text NOT NULL UNIQUE CHECK (length(phone_number_id) BETWEEN 1 AND 512),
  waba_id text NOT NULL CHECK (length(waba_id) BETWEEN 1 AND 512),
  app_reference text NOT NULL CHECK (length(app_reference) BETWEEN 1 AND 120),
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version>=1),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_by uuid,
  UNIQUE(business_id,id)
);
CREATE INDEX channels_business_idx ON app.whatsapp_channels(business_id);

CREATE TABLE app.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,
  channel_id uuid NOT NULL,
  event_key text NOT NULL CHECK (length(event_key) BETWEEN 1 AND 2048),
  event_type text NOT NULL CHECK (event_type IN ('message','status','unsupported')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object' AND octet_length(payload::text)<=16384),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','processed','dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz,
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token>=0),
  last_error_code text CHECK (length(last_error_code)<=120),
  version integer NOT NULL DEFAULT 1 CHECK (version>=1),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_by uuid,
  UNIQUE(business_id,id), UNIQUE(business_id,event_key),
  FOREIGN KEY(business_id,channel_id) REFERENCES app.whatsapp_channels(business_id,id) ON DELETE RESTRICT,
  CHECK (status<>'processing' OR lease_until IS NOT NULL)
);
CREATE INDEX webhook_channel_idx ON app.webhook_events(business_id,channel_id);
CREATE INDEX webhook_pending_idx ON app.webhook_events(status,next_attempt_at,lease_until);

CREATE FUNCTION app.touch_version() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $$ BEGIN
  NEW.created_at := OLD.created_at;
  NEW.updated_at := clock_timestamp();
  NEW.version := OLD.version+1;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.touch_version() FROM PUBLIC;
CREATE TRIGGER business_touch BEFORE UPDATE ON app.businesses FOR EACH ROW EXECUTE FUNCTION app.touch_version();
CREATE TRIGGER membership_touch BEFORE UPDATE ON app.business_memberships FOR EACH ROW EXECUTE FUNCTION app.touch_version();
CREATE TRIGGER channel_touch BEFORE UPDATE ON app.whatsapp_channels FOR EACH ROW EXECUTE FUNCTION app.touch_version();
CREATE TRIGGER webhook_touch BEFORE UPDATE ON app.webhook_events FOR EACH ROW EXECUTE FUNCTION app.touch_version();

ALTER TABLE app.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.businesses FORCE ROW LEVEL SECURITY;
ALTER TABLE app.business_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.business_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE app.whatsapp_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.whatsapp_channels FORCE ROW LEVEL SECURITY;
ALTER TABLE app.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.webhook_events FORCE ROW LEVEL SECURITY;

CREATE POLICY membership_self_read ON app.business_memberships FOR SELECT TO app_api
  USING (user_id=app.actor_id() AND active);
CREATE POLICY business_member_read ON app.businesses FOR SELECT TO app_api
  USING (deleted_at IS NULL AND status='active'
    AND (app.tenant_id() IS NULL OR id=app.tenant_id())
    AND EXISTS (SELECT 1 FROM app.business_memberships m WHERE m.business_id=businesses.id AND m.user_id=app.actor_id() AND m.active));
CREATE POLICY business_ingress_read ON app.businesses FOR SELECT TO app_ingress
  USING (status='active' AND deleted_at IS NULL);
CREATE POLICY channel_ingress_read ON app.whatsapp_channels FOR SELECT TO app_ingress
  USING (enabled AND EXISTS(SELECT 1 FROM app.businesses b WHERE b.id=whatsapp_channels.business_id AND b.status='active' AND b.deleted_at IS NULL));
CREATE POLICY webhook_ingress_read ON app.webhook_events FOR SELECT TO app_ingress
  USING (business_id=app.tenant_id());
CREATE POLICY webhook_ingress_insert ON app.webhook_events FOR INSERT TO app_ingress
  WITH CHECK (business_id=app.tenant_id() AND EXISTS(SELECT 1 FROM app.whatsapp_channels c
    WHERE c.business_id=webhook_events.business_id AND c.id=webhook_events.channel_id AND c.enabled));

GRANT SELECT ON app.businesses,app.business_memberships TO app_api;
GRANT SELECT(id,status,deleted_at) ON app.businesses TO app_ingress;
GRANT SELECT(id,business_id,phone_number_id,enabled) ON app.whatsapp_channels TO app_ingress;
GRANT SELECT,INSERT ON app.webhook_events TO app_ingress;
-- No UPDATE/DELETE/DDL for runtime. No grants to anon/authenticated/service_role.
-- Provision two separate LOGIN principals outside this migration; grant exactly one capability role to each.
-- The migration owner is never a runtime principal. No SECURITY DEFINER functions are created.
COMMIT;
