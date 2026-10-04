-- Phase 3: additive domain persistence; no worker, AI, transport or production deployment.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_worker') THEN
    CREATE ROLE app_worker NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('app_api','app_ingress','app_worker')
    AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolcanlogin)) THEN
    RAISE EXCEPTION 'Runtime capability roles must be restricted NOLOGIN roles';
  END IF;
END $$;
GRANT USAGE ON SCHEMA app TO app_worker;
GRANT EXECUTE ON FUNCTION app.actor_id(),app.tenant_id() TO app_worker;
-- All amounts remain PostgreSQL bigint, bounded for the canonical JSON number DTO.
CREATE DOMAIN app.money_minor AS bigint CHECK(VALUE BETWEEN 0 AND 9007199254740991);
CREATE DOMAIN app.quantity AS integer CHECK(VALUE BETWEEN 1 AND 99);

CREATE FUNCTION app.object_shape(v jsonb, keys text[], required_keys text[], bytes integer)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog
AS $$ SELECT CASE WHEN jsonb_typeof(v)<>'object' OR octet_length(v::text)>bytes THEN false
 ELSE v ?& required_keys AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE NOT k=ANY(keys)) END $$;
CREATE FUNCTION app.json_text(v jsonb, lo integer, hi integer) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog
AS $$ SELECT coalesce(jsonb_typeof(v)='string' AND length(v#>>'{}') BETWEEN lo AND hi,false) $$;
CREATE FUNCTION app.json_integer(v jsonb, lo bigint, hi bigint) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog
AS $$ BEGIN
 IF jsonb_typeof(v)<>'number' OR v IS NULL THEN RETURN false; END IF;
 RETURN (v#>>'{}')::numeric BETWEEN lo AND hi AND trunc((v#>>'{}')::numeric)=(v#>>'{}')::numeric;
END $$;
CREATE FUNCTION app.coordinates_valid(lat jsonb, lon jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog
AS $$ BEGIN
 IF lat='null'::jsonb AND lon='null'::jsonb THEN RETURN true; END IF;
 IF jsonb_typeof(lat) IS DISTINCT FROM 'number' OR jsonb_typeof(lon) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
 RETURN (lat#>>'{}')::numeric BETWEEN -90 AND 90 AND (lon#>>'{}')::numeric BETWEEN -180 AND 180;
END $$;
CREATE FUNCTION app.address_snapshot_valid(v jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog
AS $$ SELECT coalesce(app.object_shape(v,ARRAY['address_text','latitude','longitude','instructions'],ARRAY['address_text','latitude','longitude','instructions'],4096)
 AND app.json_text(v->'address_text',1,1000) AND app.coordinates_valid(v->'latitude',v->'longitude')
 AND (v->'instructions'='null'::jsonb OR app.json_text(v->'instructions',0,1000)),false) $$;
CREATE FUNCTION app.opening_hours_valid(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog
AS $$ DECLARE slot jsonb; BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'array' OR octet_length(v::text)>8192 OR jsonb_array_length(v)>42 THEN RETURN false; END IF;
 FOR slot IN SELECT value FROM jsonb_array_elements(v) LOOP
   IF NOT coalesce(app.object_shape(slot,ARRAY['day','opens_at','closes_at'],ARRAY['day','opens_at','closes_at'],128)
     AND app.json_integer(slot->'day',0,6) AND app.json_text(slot->'opens_at',5,5) AND app.json_text(slot->'closes_at',5,5)
     AND slot->>'opens_at' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     AND slot->>'closes_at' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     AND slot->>'opens_at' < slot->>'closes_at',false) THEN RETURN false; END IF;
 END LOOP;
 RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v) WITH ORDINALITY a(s,i)
 JOIN jsonb_array_elements(v) WITH ORDINALITY b(s,i) ON a.i<b.i
 WHERE a.s->>'day'=b.s->>'day' AND a.s->>'opens_at'<b.s->>'closes_at' AND b.s->>'opens_at'<a.s->>'closes_at');
END $$;
CREATE FUNCTION app.option_snapshots_valid(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog
AS $$ DECLARE item jsonb; BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'array' OR octet_length(v::text)>16384 OR jsonb_array_length(v)>99 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(v) LOOP
   IF NOT coalesce(app.object_shape(item,ARRAY['name','price_delta_minor'],ARRAY['name','price_delta_minor'],512)
    AND app.json_text(item->'name',1,120) AND app.json_integer(item->'price_delta_minor',0,9007199254740991),false) THEN RETURN false; END IF;
 END LOOP; RETURN true;
END $$;
CREATE FUNCTION app.option_ids_valid(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog
AS $$ BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'array' OR octet_length(v::text)>8192 OR jsonb_array_length(v)>99 THEN RETURN false; END IF;
 RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v) e WHERE NOT app.json_text(e,36,36)
   OR e#>>'{}' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
   AND (SELECT count(DISTINCT value) FROM jsonb_array_elements(v))=jsonb_array_length(v);
END $$;
CREATE FUNCTION app.polygon_valid(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog
AS $$ DECLARE ring jsonb; point jsonb; BEGIN
 IF NOT coalesce(app.object_shape(v,ARRAY['type','coordinates'],ARRAY['type','coordinates'],65536),false)
 OR v->>'type'<>'Polygon' OR jsonb_typeof(v->'coordinates') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(v->'coordinates') NOT BETWEEN 1 AND 16 THEN RETURN false; END IF;
 FOR ring IN SELECT value FROM jsonb_array_elements(v->'coordinates') LOOP
  IF jsonb_typeof(ring) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(ring) NOT BETWEEN 4 AND 512 OR ring->0<>ring->(jsonb_array_length(ring)-1) THEN RETURN false; END IF;
  FOR point IN SELECT value FROM jsonb_array_elements(ring) LOOP
   IF jsonb_typeof(point) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
   IF jsonb_array_length(point)<>2 OR NOT app.coordinates_valid(point->1,point->0)
    OR jsonb_typeof(point->0)<>'number' THEN RETURN false; END IF;
  END LOOP;
 END LOOP; RETURN true;
END $$;
CREATE FUNCTION app.message_content_valid(kind text,v jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog
AS $$ SELECT CASE kind
 WHEN 'text' THEN app.object_shape(v,ARRAY['text'],ARRAY['text'],8192) AND app.json_text(v->'text',1,2000)
 WHEN 'interactive' THEN app.object_shape(v,ARRAY['id','title'],ARRAY['id','title'],4096) AND app.json_text(v->'id',1,512) AND app.json_text(v->'title',0,200)
 WHEN 'location' THEN app.object_shape(v,ARRAY['latitude','longitude'],ARRAY['latitude','longitude'],256) AND app.coordinates_valid(v->'latitude',v->'longitude') AND jsonb_typeof(v->'latitude')='number'
 WHEN 'unsupported' THEN app.object_shape(v,ARRAY['type'],ARRAY['type'],256) AND app.json_text(v->'type',1,64)
 ELSE false END $$;
-- Redacted operational documents accept only explicit primitive metadata, never opaque arbitrary JSON.
CREATE FUNCTION app.redacted_valid(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog
AS $$ DECLARE item record; BEGIN
 IF NOT coalesce(app.object_shape(v,ARRAY['code','status','version','resource_id','count','total_minor','currency','action','tool_name','arguments_hash'],ARRAY[]::text[],2048),false) THEN RETURN false; END IF;
 FOR item IN SELECT key,value FROM jsonb_each(v) LOOP
  IF item.key IN ('version','count','total_minor') THEN
   IF NOT app.json_integer(item.value,0,9007199254740991) THEN RETURN false; END IF;
  ELSIF NOT app.json_text(item.value,0,120) THEN RETURN false; END IF;
 END LOOP; RETURN true;
END $$;
CREATE FUNCTION app.plan_valid(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog
AS $$ DECLARE item jsonb; BEGIN
 IF NOT coalesce(app.object_shape(v,ARRAY['actions'],ARRAY['actions'],8192),false) OR jsonb_typeof(v->'actions') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(v->'actions')>8 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(v->'actions') LOOP
  IF NOT coalesce(app.object_shape(item,ARRAY['tool_name','arguments_hash'],ARRAY['tool_name','arguments_hash'],256)
   AND item->>'tool_name'=ANY(ARRAY['get_menu','search_products','get_product_details','add_cart_item','remove_cart_item','get_cart','set_delivery_address','calculate_delivery','create_order','confirm_order','request_human_agent'])
   AND app.json_text(item->'arguments_hash',64,64) AND item->>'arguments_hash' ~ '^[a-f0-9]{64}$',false) THEN RETURN false; END IF;
 END LOOP; RETURN true;
END $$;
CREATE FUNCTION app.outbox_payload_valid(v jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog
AS $$ SELECT coalesce(app.object_shape(v,ARRAY['text','resource_id','resource_version'],ARRAY['resource_id','resource_version'],8192)
 AND app.json_text(v->'resource_id',36,36) AND v->>'resource_id' ~ '^[0-9a-fA-F-]{36}$'
 AND app.json_integer(v->'resource_version',1,2147483647)
 AND (NOT v?'text' OR app.json_text(v->'text',1,2000)),false) $$;

CREATE TABLE app.business_settings (
 business_id uuid PRIMARY KEY REFERENCES app.businesses(id) ON DELETE RESTRICT,
 opening_hours jsonb NOT NULL DEFAULT '[]' CHECK(app.opening_hours_valid(opening_hours)),
 accepting_orders boolean NOT NULL DEFAULT false, delivery_enabled boolean NOT NULL DEFAULT false,
 pickup_enabled boolean NOT NULL DEFAULT true, min_order_minor app.money_minor NOT NULL DEFAULT 0,
 session_ttl_minutes integer NOT NULL DEFAULT 60 CHECK(session_ttl_minutes BETWEEN 15 AND 1440),
 ai_enabled boolean NOT NULL DEFAULT false CHECK(NOT ai_enabled)
);
CREATE TABLE app.customers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,
 channel_user_id text NOT NULL CHECK(length(channel_user_id) BETWEEN 1 AND 512),
 phone_e164 text CHECK(phone_e164 ~ '^\+[1-9][0-9]{6,14}$'), display_name text CHECK(length(display_name)<=120),
 preferences jsonb CHECK(app.object_shape(preferences,ARRAY['language'],ARRAY[]::text[],256) AND (NOT preferences?'language' OR app.json_text(preferences->'language',2,10))),
 consent_at timestamptz, deleted_at timestamptz, UNIQUE(business_id,id), UNIQUE(business_id,channel_user_id)
);
CREATE TABLE app.conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,
 customer_id uuid NOT NULL, channel_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'bot_active' CHECK(status IN ('bot_active','human_pending','human_active','closed')),
 last_customer_message_at timestamptz, summary text CHECK(length(summary)<=4000), summary_through_message_id uuid,
 expires_at timestamptz NOT NULL, automation_epoch bigint NOT NULL DEFAULT 1 CHECK(automation_epoch BETWEEN 1 AND 9007199254740991),
 UNIQUE(business_id,id), UNIQUE(business_id,id,customer_id),
 FOREIGN KEY(business_id,customer_id) REFERENCES app.customers(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,channel_id) REFERENCES app.whatsapp_channels(business_id,id) ON DELETE RESTRICT
);
CREATE TABLE app.outbox_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,
 conversation_id uuid, event_type text NOT NULL CHECK(event_type IN ('order.created','order.status_changed','conversation.updated','message.received','message.delivery_updated','handoff.created','handoff.resolved','whatsapp.message')),
 aggregate_id uuid NOT NULL, aggregate_version integer NOT NULL CHECK(aggregate_version>=1), causation_id uuid NOT NULL,
 dedupe_key text NOT NULL CHECK(length(dedupe_key) BETWEEN 1 AND 1024), payload jsonb NOT NULL CHECK(app.outbox_payload_valid(payload)),
 automation_epoch bigint CHECK(automation_epoch BETWEEN 1 AND 9007199254740991),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','unknown','dead_letter')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), next_attempt_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz,
 fencing_token bigint NOT NULL DEFAULT 0 CHECK(fencing_token>=0), provider_message_id text CHECK(length(provider_message_id) BETWEEN 1 AND 512),
 UNIQUE(business_id,id), UNIQUE(business_id,dedupe_key), UNIQUE(business_id,id,conversation_id),
 CHECK(status<>'sending' OR lease_until IS NOT NULL),
 FOREIGN KEY(business_id,conversation_id) REFERENCES app.conversations(business_id,id) ON DELETE RESTRICT
);
CREATE TABLE app.messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,
 conversation_id uuid NOT NULL, direction text NOT NULL CHECK(direction IN ('inbound','outbound')),
 provider_message_id text CHECK(length(provider_message_id) BETWEEN 1 AND 512),
 kind text NOT NULL CHECK(kind IN ('text','interactive','location','unsupported')), content jsonb CHECK(content IS NULL OR coalesce(app.message_content_valid(kind,content),false)),
 actor_type text NOT NULL CHECK(actor_type IN ('customer','bot','human','system')),
 delivery_status text CHECK(delivery_status IN ('pending','sent','delivered','read','failed','unknown')),
 provider_timestamp timestamptz, outbox_id uuid,
 UNIQUE(business_id,id), UNIQUE(business_id,id,conversation_id),
 CHECK((direction='inbound' AND actor_type='customer' AND outbox_id IS NULL) OR (direction='outbound' AND actor_type<>'customer' AND outbox_id IS NOT NULL)),
 FOREIGN KEY(business_id,conversation_id) REFERENCES app.conversations(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,outbox_id,conversation_id) REFERENCES app.outbox_events(business_id,id,conversation_id) ON DELETE RESTRICT
);
ALTER TABLE app.conversations ADD CONSTRAINT conversations_summary_message_fk
 FOREIGN KEY(business_id,summary_through_message_id,id) REFERENCES app.messages(business_id,id,conversation_id) ON DELETE RESTRICT;
CREATE TABLE app.categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120), sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order BETWEEN 0 AND 100000),
 active boolean NOT NULL DEFAULT true, deleted_at timestamptz, UNIQUE(business_id,id)
);
CREATE TABLE app.products (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,
 category_id uuid NOT NULL, name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120), description text CHECK(length(description)<=2000),
 price_minor app.money_minor NOT NULL, currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'), available boolean NOT NULL DEFAULT true,
 image_url text CHECK(length(image_url)<=2048 AND image_url ~ '^https://[^/@[:space:]]+(/[^[:space:]]*)?$'), deleted_at timestamptz,
 UNIQUE(business_id,id), FOREIGN KEY(business_id,category_id) REFERENCES app.categories(business_id,id) ON DELETE RESTRICT
);
CREATE TABLE app.modifier_groups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,
 product_id uuid NOT NULL, name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120), required boolean NOT NULL DEFAULT false,
 min_select integer NOT NULL DEFAULT 0, max_select integer NOT NULL DEFAULT 1,
 sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order BETWEEN 0 AND 100000), active boolean NOT NULL DEFAULT true, deleted_at timestamptz,
 CHECK(0<=min_select AND min_select<=max_select AND max_select<=99 AND (NOT required OR min_select>=1)),
 UNIQUE(business_id,id), UNIQUE(business_id,id,product_id),
 FOREIGN KEY(business_id,product_id) REFERENCES app.products(business_id,id) ON DELETE RESTRICT
);
CREATE TABLE app.modifier_options (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,
 modifier_group_id uuid NOT NULL, name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120), price_delta_minor app.money_minor NOT NULL DEFAULT 0,
 available boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order BETWEEN 0 AND 100000), deleted_at timestamptz,
 UNIQUE(business_id,id), FOREIGN KEY(business_id,modifier_group_id) REFERENCES app.modifier_groups(business_id,id) ON DELETE RESTRICT
);
CREATE TABLE app.addresses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,
 customer_id uuid NOT NULL, label text CHECK(length(label)<=120), address_text text NOT NULL CHECK(length(address_text) BETWEEN 1 AND 1000),
 latitude numeric(10,7), longitude numeric(10,7), instructions text CHECK(length(instructions)<=1000), deleted_at timestamptz,
 CHECK((latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)),
 UNIQUE(business_id,id), FOREIGN KEY(business_id,customer_id) REFERENCES app.customers(business_id,id) ON DELETE RESTRICT
);
CREATE TABLE app.delivery_zones (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120), polygon_geojson jsonb NOT NULL CHECK(app.polygon_valid(polygon_geojson)),
 fee_minor app.money_minor NOT NULL, min_order_minor app.money_minor NOT NULL DEFAULT 0,
 priority integer NOT NULL DEFAULT 0 CHECK(priority BETWEEN 0 AND 100000), active boolean NOT NULL DEFAULT true, deleted_at timestamptz, UNIQUE(business_id,id)
);
CREATE TABLE app.carts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,
 customer_id uuid NOT NULL, conversation_id uuid NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','converted','expired')),
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'), expires_at timestamptz NOT NULL,
 UNIQUE(business_id,id), UNIQUE(business_id,id,customer_id,conversation_id),
 FOREIGN KEY(business_id,customer_id) REFERENCES app.customers(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,conversation_id,customer_id) REFERENCES app.conversations(business_id,id,customer_id) ON DELETE RESTRICT
);
CREATE TABLE app.cart_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,
 cart_id uuid NOT NULL, product_id uuid NOT NULL, selected_options jsonb NOT NULL DEFAULT '[]' CHECK(app.option_ids_valid(selected_options)),
 options_fingerprint text NOT NULL CHECK(options_fingerprint ~ '^[a-f0-9]{64}$'), quantity app.quantity NOT NULL, notes text CHECK(length(notes)<=1000),
 UNIQUE(business_id,id), UNIQUE(business_id,cart_id,product_id,options_fingerprint),
 FOREIGN KEY(business_id,cart_id) REFERENCES app.carts(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,product_id) REFERENCES app.products(business_id,id) ON DELETE RESTRICT
);
CREATE TABLE app.orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,
 customer_id uuid NOT NULL, conversation_id uuid NOT NULL, source_cart_id uuid NOT NULL, source_cart_version integer NOT NULL CHECK(source_cart_version>=1),
 status text NOT NULL DEFAULT 'awaiting_confirmation' CHECK(status IN ('awaiting_confirmation','confirmed','accepted','preparing','ready','out_for_delivery','delivered','cancelled')),
 fulfillment text NOT NULL CHECK(fulfillment IN ('pickup','delivery')), currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 subtotal_minor app.money_minor NOT NULL, tax_minor app.money_minor NOT NULL DEFAULT 0, delivery_minor app.money_minor NOT NULL DEFAULT 0,
 discount_minor app.money_minor NOT NULL DEFAULT 0, total_minor app.money_minor NOT NULL,
 address_snapshot jsonb CHECK(address_snapshot IS NULL OR app.address_snapshot_valid(address_snapshot)), zone_id uuid, quote_expires_at timestamptz NOT NULL,
 confirmed_at timestamptz, confirmation_message_id uuid, cancellation_reason text CHECK(length(btrim(cancellation_reason)) BETWEEN 1 AND 1000),
 CHECK(total_minor::numeric=subtotal_minor::numeric+tax_minor::numeric+delivery_minor::numeric-discount_minor::numeric),
 CHECK((fulfillment='delivery' AND address_snapshot IS NOT NULL AND zone_id IS NOT NULL) OR (fulfillment='pickup' AND address_snapshot IS NULL AND zone_id IS NULL AND delivery_minor=0)),
 CHECK(status NOT IN ('confirmed','accepted','preparing','ready','out_for_delivery','delivered') OR (confirmed_at IS NOT NULL AND confirmation_message_id IS NOT NULL)),
 CHECK((confirmed_at IS NULL)=(confirmation_message_id IS NULL)), CHECK(status<>'awaiting_confirmation' OR confirmed_at IS NULL),
 CHECK(status<>'cancelled' OR cancellation_reason IS NOT NULL), CHECK(status<>'out_for_delivery' OR fulfillment='delivery'),
 UNIQUE(business_id,id), UNIQUE(business_id,id,customer_id,conversation_id), UNIQUE(business_id,source_cart_id,source_cart_version),
 FOREIGN KEY(business_id,customer_id) REFERENCES app.customers(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,conversation_id,customer_id) REFERENCES app.conversations(business_id,id,customer_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,source_cart_id,customer_id,conversation_id) REFERENCES app.carts(business_id,id,customer_id,conversation_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,zone_id) REFERENCES app.delivery_zones(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,confirmation_message_id,conversation_id) REFERENCES app.messages(business_id,id,conversation_id) ON DELETE RESTRICT
);
CREATE TABLE app.order_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,
 order_id uuid NOT NULL, product_id uuid, name_snapshot text NOT NULL CHECK(length(name_snapshot) BETWEEN 1 AND 120),
 option_snapshots jsonb NOT NULL DEFAULT '[]' CHECK(app.option_snapshots_valid(option_snapshots)),
 unit_price_minor app.money_minor NOT NULL, quantity app.quantity NOT NULL, line_total_minor app.money_minor NOT NULL, notes text CHECK(length(notes)<=1000),
 CHECK(line_total_minor::numeric=unit_price_minor::numeric*quantity), UNIQUE(business_id,id),
 FOREIGN KEY(business_id,order_id) REFERENCES app.orders(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,product_id) REFERENCES app.products(business_id,id) ON DELETE RESTRICT
);
CREATE TABLE app.payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,
 order_id uuid NOT NULL, method text NOT NULL DEFAULT 'cash_on_delivery' CHECK(method='cash_on_delivery'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','cancelled')), amount_minor app.money_minor NOT NULL,
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'), provider text CHECK(length(provider)<=64), provider_payment_id text CHECK(length(provider_payment_id)<=512),
 recorded_by uuid, paid_at timestamptz, note text CHECK(length(note)<=1000),
 CHECK((status='paid' AND paid_at IS NOT NULL AND recorded_by IS NOT NULL AND note IS NOT NULL AND length(btrim(note))>0) OR (status<>'paid' AND paid_at IS NULL)),
 UNIQUE(business_id,id), UNIQUE(business_id,order_id,method),
 FOREIGN KEY(business_id,order_id) REFERENCES app.orders(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,recorded_by) REFERENCES app.business_memberships(business_id,user_id) ON DELETE RESTRICT
);
CREATE TABLE app.human_handoffs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,
 conversation_id uuid NOT NULL, reason text NOT NULL CHECK(reason IN ('explicit_request','misunderstanding','complaint','payment_issue','system_failure')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','resolved')), assigned_user_id uuid,
 resolved_at timestamptz, resolution text CHECK(length(resolution)<=1000),
 CHECK(status<>'active' OR assigned_user_id IS NOT NULL), CHECK(status<>'resolved' OR (resolved_at IS NOT NULL AND resolution IS NOT NULL AND length(btrim(resolution))>0)),
 UNIQUE(business_id,id), FOREIGN KEY(business_id,conversation_id) REFERENCES app.conversations(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,assigned_user_id) REFERENCES app.business_memberships(business_id,user_id) ON DELETE RESTRICT
);
CREATE TABLE app.audit_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,
 actor_type text NOT NULL CHECK(actor_type IN ('customer','human','system')), actor_id uuid,
 action text NOT NULL CHECK(length(action) BETWEEN 1 AND 120), resource_type text NOT NULL CHECK(length(resource_type) BETWEEN 1 AND 120),
 resource_id uuid NOT NULL, request_id uuid NOT NULL, before_redacted jsonb CHECK(before_redacted IS NULL OR app.redacted_valid(before_redacted)), after_redacted jsonb CHECK(after_redacted IS NULL OR app.redacted_valid(after_redacted)),
 UNIQUE(business_id,id)
);
CREATE TABLE app.idempotency_keys (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,
 actor_scope text NOT NULL CHECK(length(actor_scope) BETWEEN 1 AND 200), operation text NOT NULL CHECK(length(operation) BETWEEN 1 AND 120),
 key_hash text NOT NULL CHECK(key_hash ~ '^[a-f0-9]{64}$'), request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed','failed')),
 response_redacted jsonb CHECK(response_redacted IS NULL OR app.redacted_valid(response_redacted)), response_status integer CHECK(response_status BETWEEN 200 AND 299),
 resource_id uuid, expires_at timestamptz NOT NULL, lease_until timestamptz, fencing_token bigint NOT NULL DEFAULT 0 CHECK(fencing_token>=0),
 CHECK(status<>'completed' OR (response_redacted IS NOT NULL AND response_status IS NOT NULL)),
 UNIQUE(business_id,id), UNIQUE(business_id,actor_scope,operation,key_hash)
);
CREATE TABLE app.order_transitions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,
 order_id uuid NOT NULL, from_status text NOT NULL, to_status text NOT NULL,
 actor_type text NOT NULL CHECK(actor_type IN ('customer','human','system')), actor_id uuid, trigger text NOT NULL CHECK(trigger IN ('confirm','accept','start_preparation','mark_ready','dispatch','complete','cancel')),
 causation_id uuid NOT NULL, resulting_version integer NOT NULL CHECK(resulting_version>=2),
 CHECK((from_status='awaiting_confirmation' AND to_status='confirmed' AND trigger='confirm' AND actor_type='customer')
 OR (from_status='confirmed' AND to_status='accepted' AND trigger='accept' AND actor_type='human')
 OR (from_status='accepted' AND to_status='preparing' AND trigger='start_preparation' AND actor_type='human')
 OR (from_status='preparing' AND to_status='ready' AND trigger='mark_ready' AND actor_type='human')
 OR (from_status='ready' AND to_status='out_for_delivery' AND trigger='dispatch' AND actor_type='human')
 OR (from_status IN ('ready','out_for_delivery') AND to_status='delivered' AND trigger='complete' AND actor_type='human')
 OR (from_status IN ('awaiting_confirmation','confirmed','accepted','preparing','ready','out_for_delivery') AND to_status='cancelled' AND trigger='cancel')),
 UNIQUE(business_id,id), UNIQUE(business_id,order_id,resulting_version),
 FOREIGN KEY(business_id,order_id) REFERENCES app.orders(business_id,id) ON DELETE RESTRICT
);
CREATE TABLE app.confirmation_challenges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,
 order_id uuid NOT NULL, customer_id uuid NOT NULL, conversation_id uuid NOT NULL, order_version integer NOT NULL CHECK(order_version>=1),
 nonce_hash text NOT NULL UNIQUE CHECK(nonce_hash ~ '^[a-f0-9]{64}$'), expires_at timestamptz NOT NULL,
 consumed_at timestamptz, confirmation_message_id uuid,
 CHECK((consumed_at IS NULL AND confirmation_message_id IS NULL) OR (consumed_at IS NOT NULL AND confirmation_message_id IS NOT NULL AND consumed_at<=expires_at)),
 UNIQUE(business_id,id), UNIQUE(business_id,order_id,order_version),
 FOREIGN KEY(business_id,order_id,customer_id,conversation_id) REFERENCES app.orders(business_id,id,customer_id,conversation_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,customer_id) REFERENCES app.customers(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,conversation_id,customer_id) REFERENCES app.conversations(business_id,id,customer_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,confirmation_message_id,conversation_id) REFERENCES app.messages(business_id,id,conversation_id) ON DELETE RESTRICT
);
CREATE TABLE app.conversation_turns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,
 conversation_id uuid NOT NULL, inbound_message_id uuid NOT NULL, automation_epoch bigint NOT NULL CHECK(automation_epoch BETWEEN 1 AND 9007199254740991),
 plan jsonb CHECK(plan IS NULL OR app.plan_valid(plan)), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','planned','completed','failed')),
 lease_until timestamptz, fencing_token bigint NOT NULL DEFAULT 0 CHECK(fencing_token>=0),
 CHECK(status NOT IN ('planned','completed') OR plan IS NOT NULL),
 UNIQUE(business_id,id), UNIQUE(business_id,inbound_message_id),
 FOREIGN KEY(business_id,conversation_id) REFERENCES app.conversations(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,inbound_message_id,conversation_id) REFERENCES app.messages(business_id,id,conversation_id) ON DELETE RESTRICT
);
CREATE TABLE app.tool_executions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,
 turn_id uuid NOT NULL, action_index integer NOT NULL CHECK(action_index BETWEEN 0 AND 7),
 tool_name text NOT NULL CHECK(tool_name IN ('get_menu','search_products','get_product_details','add_cart_item','remove_cart_item','get_cart','set_delivery_address','calculate_delivery','create_order','confirm_order','request_human_agent')),
 arguments_hash text NOT NULL CHECK(arguments_hash ~ '^[a-f0-9]{64}$'), arguments_redacted jsonb CHECK(arguments_redacted IS NULL OR app.redacted_valid(arguments_redacted)),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','failed')), result_redacted jsonb CHECK(result_redacted IS NULL OR app.redacted_valid(result_redacted)), idempotency_key_id uuid,
 UNIQUE(business_id,id), UNIQUE(business_id,turn_id,action_index),
 FOREIGN KEY(business_id,turn_id) REFERENCES app.conversation_turns(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,idempotency_key_id) REFERENCES app.idempotency_keys(business_id,id) ON DELETE RESTRICT
);

-- Common audit/version columns and triggers for exactly the new tables (constant identifier list).
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['business_settings','customers','conversations','outbox_events','messages','categories','products','modifier_groups','modifier_options','addresses','delivery_zones','carts','cart_items','orders','order_items','payments','human_handoffs','audit_logs','idempotency_keys','order_transitions','confirmation_challenges','conversation_turns','tool_executions'] LOOP
  EXECUTE format('ALTER TABLE app.%I ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>=1), ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN created_by uuid, ADD COLUMN updated_by uuid',t);
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  IF t NOT IN ('audit_logs','order_transitions') THEN
   EXECUTE format('CREATE TRIGGER z_touch_version BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.touch_version()',t);
  END IF;
 END LOOP;
END $$;
CREATE UNIQUE INDEX categories_live_name ON app.categories(business_id,lower(btrim(name))) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX modifier_groups_live_name ON app.modifier_groups(business_id,product_id,lower(btrim(name))) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX modifier_options_live_name ON app.modifier_options(business_id,modifier_group_id,lower(btrim(name))) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX conversations_open ON app.conversations(business_id,customer_id,channel_id) WHERE status<>'closed';
CREATE UNIQUE INDEX carts_active ON app.carts(business_id,conversation_id) WHERE status='active';
CREATE UNIQUE INDEX orders_one_converted_cart ON app.orders(business_id,source_cart_id) WHERE status IN ('confirmed','accepted','preparing','ready','out_for_delivery','delivered') OR confirmed_at IS NOT NULL;
CREATE UNIQUE INDEX messages_provider_id ON app.messages(business_id,provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE UNIQUE INDEX messages_outbox_id ON app.messages(business_id,outbox_id) WHERE outbox_id IS NOT NULL;
CREATE UNIQUE INDEX challenge_confirmation_message ON app.confirmation_challenges(business_id,confirmation_message_id) WHERE confirmation_message_id IS NOT NULL;
CREATE UNIQUE INDEX payments_provider_id ON app.payments(provider,provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE UNIQUE INDEX handoffs_open ON app.human_handoffs(business_id,conversation_id) WHERE status IN ('pending','active');
CREATE INDEX customers_phone ON app.customers(business_id,phone_e164);
CREATE INDEX conversations_status ON app.conversations(business_id,status,updated_at);
CREATE INDEX messages_history ON app.messages(business_id,conversation_id,created_at,id);
CREATE INDEX categories_menu ON app.categories(business_id,active,sort_order) WHERE deleted_at IS NULL;
CREATE INDEX products_menu ON app.products(business_id,available,category_id) WHERE deleted_at IS NULL;
CREATE INDEX delivery_zones_priority ON app.delivery_zones(business_id,active,priority) WHERE deleted_at IS NULL;
CREATE INDEX carts_expiration ON app.carts(business_id,status,expires_at);
CREATE INDEX orders_status ON app.orders(business_id,status,created_at,id);
CREATE INDEX handoffs_queue ON app.human_handoffs(business_id,status,created_at);
CREATE INDEX audit_resource ON app.audit_logs(business_id,resource_type,resource_id,created_at);
CREATE INDEX audit_request ON app.audit_logs(request_id);
CREATE INDEX idempotency_expiration ON app.idempotency_keys(business_id,expires_at);
CREATE INDEX outbox_queue ON app.outbox_events(business_id,status,next_attempt_at,lease_until);
CREATE INDEX turns_queue ON app.conversation_turns(business_id,status,lease_until);
CREATE INDEX tools_status ON app.tool_executions(business_id,status);
-- Every FK receives an index with matching leading columns, unless an existing nonpartial index covers it.
DO $$ DECLARE f record; cols text; BEGIN
 FOR f IN SELECT c.* FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
 WHERE n.nspname='app' AND c.contype='f' LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=f.conrelid AND i.indpred IS NULL AND i.indisvalid
    AND ARRAY(SELECT unnest(i.indkey) LIMIT cardinality(f.conkey))=f.conkey) THEN
   SELECT string_agg(format('%I',a.attname),',' ORDER BY u.pos) INTO cols FROM unnest(f.conkey) WITH ORDINALITY u(attnum,pos)
    JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=u.attnum;
   EXECUTE format('CREATE INDEX %I ON %s (%s)', f.conname||'_idx',f.conrelid::regclass,cols);
  END IF;
 END LOOP;
END $$;

CREATE FUNCTION app.member_of(tenant uuid, roles text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog
AS $$ SELECT tenant=(SELECT app.tenant_id()) AND EXISTS(SELECT 1 FROM app.business_memberships m
 JOIN app.businesses b ON b.id=m.business_id WHERE m.business_id=tenant AND m.user_id=(SELECT app.actor_id())
 AND m.active AND m.role=ANY(roles) AND b.status='active' AND b.deleted_at IS NULL) $$;
CREATE FUNCTION app.worker_tenant(tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog
AS $$ SELECT tenant=(SELECT app.tenant_id()) AND EXISTS(SELECT 1 FROM app.businesses b WHERE b.id=tenant AND b.status='active' AND b.deleted_at IS NULL) $$;
GRANT SELECT(id,status,deleted_at,currency) ON app.businesses TO app_worker;
CREATE POLICY business_worker_read ON app.businesses FOR SELECT TO app_worker USING(id=(SELECT app.tenant_id()) AND status='active' AND deleted_at IS NULL);
GRANT SELECT(id,business_id,phone_number_id,enabled) ON app.whatsapp_channels TO app_worker;
CREATE POLICY channel_worker_read ON app.whatsapp_channels FOR SELECT TO app_worker USING(business_id=(SELECT app.tenant_id()) AND enabled);
GRANT SELECT ON app.webhook_events TO app_worker;
GRANT UPDATE(status,attempts,next_attempt_at,lease_until,fencing_token,last_error_code) ON app.webhook_events TO app_worker;
CREATE POLICY inbox_worker_read ON app.webhook_events FOR SELECT TO app_worker USING(app.worker_tenant(business_id));
CREATE POLICY inbox_worker_update ON app.webhook_events FOR UPDATE TO app_worker USING(app.worker_tenant(business_id)) WITH CHECK(app.worker_tenant(business_id));

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['business_settings','customers','conversations','messages','categories','products','modifier_groups','modifier_options','addresses','delivery_zones','carts','cart_items','orders','order_items','payments','human_handoffs','order_transitions'] LOOP
  EXECUTE format('GRANT SELECT ON app.%I TO app_api',t);
  EXECUTE format('CREATE POLICY api_read ON app.%I FOR SELECT TO app_api USING(app.member_of(business_id,ARRAY[''owner'',''manager'',''operator'']))',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['business_settings','categories','products','modifier_groups','modifier_options','delivery_zones'] LOOP
  EXECUTE format('GRANT INSERT ON app.%I TO app_api',t);
  EXECUTE format('CREATE POLICY api_insert ON app.%I FOR INSERT TO app_api WITH CHECK(app.member_of(business_id,ARRAY[''owner'',''manager'']))',t);
  EXECUTE format('CREATE POLICY api_update ON app.%I FOR UPDATE TO app_api USING(app.member_of(business_id,ARRAY[''owner'',''manager''])) WITH CHECK(app.member_of(business_id,ARRAY[''owner'',''manager'']))',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['business_settings','categories','products','modifier_groups','modifier_options','delivery_zones','customers','conversations','outbox_events','messages','addresses','carts','cart_items','orders','order_items','payments','human_handoffs','audit_logs','idempotency_keys','order_transitions','confirmation_challenges','conversation_turns','tool_executions'] LOOP
  EXECUTE format('GRANT SELECT ON app.%I TO app_worker',t);
  EXECUTE format('CREATE POLICY worker_read ON app.%I FOR SELECT TO app_worker USING(app.worker_tenant(business_id))',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['customers','conversations','outbox_events','messages','addresses','carts','cart_items','orders','order_items','payments','human_handoffs','audit_logs','idempotency_keys','order_transitions','confirmation_challenges','conversation_turns','tool_executions'] LOOP
  EXECUTE format('GRANT INSERT ON app.%I TO app_worker',t);
  EXECUTE format('CREATE POLICY worker_insert ON app.%I FOR INSERT TO app_worker WITH CHECK(app.worker_tenant(business_id))',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['customers','conversations','outbox_events','messages','addresses','carts','cart_items','orders','human_handoffs','idempotency_keys','confirmation_challenges','conversation_turns','tool_executions'] LOOP
  EXECUTE format('CREATE POLICY worker_update ON app.%I FOR UPDATE TO app_worker USING(app.worker_tenant(business_id)) WITH CHECK(app.worker_tenant(business_id))',t);
 END LOOP;
END $$;
-- Column grants prevent primary key / tenant / ownership rewrites. No runtime DELETE of historical data.
GRANT UPDATE(opening_hours,accepting_orders,delivery_enabled,pickup_enabled,min_order_minor,session_ttl_minutes,updated_by) ON app.business_settings TO app_api;
GRANT UPDATE(name,sort_order,active,deleted_at,updated_by) ON app.categories TO app_api;
GRANT UPDATE(category_id,name,description,price_minor,available,image_url,deleted_at,updated_by) ON app.products TO app_api;
GRANT UPDATE(name,required,min_select,max_select,sort_order,active,deleted_at,updated_by) ON app.modifier_groups TO app_api;
GRANT UPDATE(name,price_delta_minor,available,sort_order,deleted_at,updated_by) ON app.modifier_options TO app_api;
GRANT UPDATE(name,polygon_geojson,fee_minor,min_order_minor,priority,active,deleted_at,updated_by) ON app.delivery_zones TO app_api;
GRANT UPDATE(display_name,phone_e164,preferences,consent_at,deleted_at,updated_by) ON app.customers TO app_worker;
GRANT UPDATE(status,last_customer_message_at,summary,summary_through_message_id,expires_at,automation_epoch,updated_by) ON app.conversations TO app_worker;
GRANT UPDATE(status,attempts,next_attempt_at,lease_until,fencing_token,provider_message_id,updated_by) ON app.outbox_events TO app_worker;
GRANT UPDATE(delivery_status,updated_by) ON app.messages TO app_worker;
GRANT UPDATE(label,address_text,latitude,longitude,instructions,deleted_at,updated_by) ON app.addresses TO app_worker;
GRANT UPDATE(status,expires_at,updated_by) ON app.carts TO app_worker;
GRANT UPDATE(selected_options,options_fingerprint,quantity,notes,updated_by) ON app.cart_items TO app_worker;
GRANT DELETE ON app.cart_items TO app_worker;
CREATE POLICY worker_delete_item ON app.cart_items FOR DELETE TO app_worker USING(app.worker_tenant(business_id));
-- No UPDATE(status) on orders for any runtime role in this phase. Action services come later.
-- PostgreSQL row locks require an UPDATE privilege; grant only the non-domain actor stamp.
GRANT UPDATE(updated_by) ON app.orders TO app_worker;
GRANT UPDATE(status,assigned_user_id,resolved_at,resolution,updated_by) ON app.human_handoffs TO app_worker;
GRANT UPDATE(status,response_redacted,response_status,resource_id,lease_until,fencing_token,updated_by) ON app.idempotency_keys TO app_worker;
GRANT UPDATE(consumed_at,confirmation_message_id,updated_by) ON app.confirmation_challenges TO app_worker;
GRANT UPDATE(plan,status,lease_until,fencing_token,updated_by) ON app.conversation_turns TO app_worker;
GRANT UPDATE(status,result_redacted,updated_by) ON app.tool_executions TO app_worker;

CREATE FUNCTION app.domain_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $$ DECLARE currency_value text; parent_status text; row_data record; BEGIN
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.business_id<>OLD.business_id) THEN RAISE EXCEPTION 'Immutable identity' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME IN ('products','carts','orders') THEN
  SELECT currency INTO currency_value FROM app.businesses WHERE id=NEW.business_id;
  IF currency_value IS DISTINCT FROM NEW.currency THEN RAISE EXCEPTION 'Aggregate currency mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME='payments' THEN
  SELECT status,currency,total_minor INTO row_data FROM app.orders WHERE business_id=NEW.business_id AND id=NEW.order_id;
  IF row_data.currency IS DISTINCT FROM NEW.currency OR row_data.total_minor IS DISTINCT FROM NEW.amount_minor THEN RAISE EXCEPTION 'Payment amount/currency mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.status='paid' AND (row_data.status IN ('awaiting_confirmation','cancelled') OR NEW.paid_at>now()
    OR NOT app.member_of(NEW.business_id,ARRAY['owner','manager'])) THEN RAISE EXCEPTION 'Unauthorized payment record' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME='cart_items' THEN
  SELECT status INTO parent_status FROM app.carts WHERE business_id=NEW.business_id AND id=NEW.cart_id FOR UPDATE;
  IF parent_status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'Cart is not active' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.selected_options) o(option_id)
    WHERE NOT EXISTS(SELECT 1 FROM app.modifier_options opt JOIN app.modifier_groups g ON g.business_id=opt.business_id AND g.id=opt.modifier_group_id
     WHERE opt.business_id=NEW.business_id AND opt.id=o.option_id::uuid AND g.product_id=NEW.product_id AND opt.available AND g.active AND opt.deleted_at IS NULL AND g.deleted_at IS NULL)) THEN RAISE EXCEPTION 'Option belongs to another product or tenant' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM app.modifier_groups g WHERE g.business_id=NEW.business_id AND g.product_id=NEW.product_id AND g.active AND g.deleted_at IS NULL
   AND (SELECT count(*) FROM app.modifier_options opt JOIN jsonb_array_elements_text(NEW.selected_options) o(id) ON opt.id=o.id::uuid
    WHERE opt.business_id=g.business_id AND opt.modifier_group_id=g.id) NOT BETWEEN g.min_select AND g.max_select) THEN
   RAISE EXCEPTION 'Modifier selection violates group cardinality' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND (SELECT count(*) FROM app.cart_items WHERE business_id=NEW.business_id AND cart_id=NEW.cart_id)>=50 THEN RAISE EXCEPTION 'Cart line limit' USING ERRCODE='23514'; END IF;
  NEW.options_fingerprint:=encode(sha256(convert_to(coalesce((SELECT string_agg(value,',' ORDER BY value) FROM jsonb_array_elements_text(NEW.selected_options)),''),'UTF8')),'hex');
 END IF;
 IF TG_TABLE_NAME='order_items' THEN
  SELECT status INTO parent_status FROM app.orders WHERE business_id=NEW.business_id AND id=NEW.order_id FOR SHARE;
  IF parent_status IS DISTINCT FROM 'awaiting_confirmation' THEN RAISE EXCEPTION 'Order snapshots are immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME='human_handoffs' AND to_jsonb(NEW)->>'assigned_user_id' IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM app.business_memberships WHERE business_id=NEW.business_id AND user_id=NEW.assigned_user_id AND active) THEN RAISE EXCEPTION 'Inactive handoff assignee' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME='orders' THEN
  IF TG_OP='INSERT' AND NEW.status<>'awaiting_confirmation' THEN RAISE EXCEPTION 'New order must await customer confirmation' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
   IF OLD.status<>'awaiting_confirmation' AND (to_jsonb(NEW)-ARRAY['status','cancellation_reason','version','updated_at','updated_by']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','cancellation_reason','version','updated_at','updated_by']) THEN RAISE EXCEPTION 'Confirmed order snapshot is immutable' USING ERRCODE='23514'; END IF;
   IF NEW.status<>OLD.status AND NOT (
    (OLD.status='awaiting_confirmation' AND NEW.status IN ('confirmed','cancelled'))
    OR (OLD.status='confirmed' AND NEW.status IN ('accepted','cancelled'))
    OR (OLD.status='accepted' AND NEW.status IN ('preparing','cancelled'))
    OR (OLD.status='preparing' AND NEW.status IN ('ready','cancelled'))
    OR (OLD.status='ready' AND (NEW.status='cancelled' OR (NEW.status='out_for_delivery' AND NEW.fulfillment='delivery') OR (NEW.status='delivered' AND NEW.fulfillment='pickup')))
    OR (OLD.status='out_for_delivery' AND NEW.status IN ('delivered','cancelled'))
   ) THEN RAISE EXCEPTION 'Invalid order transition' USING ERRCODE='23514'; END IF;
   IF NEW.status='confirmed' AND OLD.status='awaiting_confirmation' AND NOT EXISTS(
     SELECT 1 FROM app.confirmation_challenges c WHERE c.business_id=NEW.business_id AND c.order_id=NEW.id
      AND c.customer_id=NEW.customer_id AND c.order_version=OLD.version AND c.consumed_at IS NOT NULL
      AND c.confirmation_message_id=NEW.confirmation_message_id AND c.expires_at>clock_timestamp()
   ) THEN RAISE EXCEPTION 'Verified challenge required' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 IF TG_TABLE_NAME='confirmation_challenges' AND TG_OP='UPDATE' AND to_jsonb(NEW)->>'consumed_at' IS NOT NULL THEN
  SELECT o.status,o.version,o.quote_expires_at INTO row_data FROM app.orders o WHERE o.business_id=NEW.business_id AND o.id=NEW.order_id;
  IF OLD.consumed_at IS NOT NULL OR NEW.expires_at<=clock_timestamp() OR row_data.quote_expires_at<=clock_timestamp()
    OR row_data.status<>'awaiting_confirmation' OR row_data.version<>NEW.order_version
    OR NOT EXISTS(SELECT 1 FROM app.messages m WHERE m.business_id=NEW.business_id AND m.id=NEW.confirmation_message_id
      AND m.conversation_id=NEW.conversation_id AND m.direction='inbound' AND m.actor_type='customer' AND m.kind='interactive') THEN
   RAISE EXCEPTION 'Invalid or consumed confirmation challenge' USING ERRCODE='23514';
  END IF;
  NEW.consumed_at:=clock_timestamp();
 END IF;
 IF TG_TABLE_NAME='tool_executions' THEN
  SELECT plan INTO row_data FROM app.conversation_turns WHERE business_id=NEW.business_id AND id=NEW.turn_id;
  IF row_data.plan IS NULL OR (row_data.plan->'actions'->NEW.action_index->>'tool_name') IS DISTINCT FROM NEW.tool_name
    OR (row_data.plan->'actions'->NEW.action_index->>'arguments_hash') IS DISTINCT FROM NEW.arguments_hash THEN
   RAISE EXCEPTION 'Tool slot does not match persisted plan' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME='order_transitions' THEN
  SELECT status,version INTO row_data FROM app.orders WHERE business_id=NEW.business_id AND id=NEW.order_id;
  IF row_data.status IS DISTINCT FROM NEW.to_status OR row_data.version IS DISTINCT FROM NEW.resulting_version THEN
   RAISE EXCEPTION 'Transition does not match order version/state' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='outbox_events' AND to_jsonb(OLD)->>'status' IN ('unknown','sent') AND to_jsonb(NEW)->>'status'<>to_jsonb(OLD)->>'status' THEN RAISE EXCEPTION 'No blind resend of unknown or sent outbox' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='confirmation_challenges' AND to_jsonb(OLD)->>'consumed_at' IS NOT NULL THEN RAISE EXCEPTION 'Challenge already consumed' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='conversation_turns' AND to_jsonb(OLD)->>'plan' IS NOT NULL AND to_jsonb(NEW)->'plan' IS DISTINCT FROM to_jsonb(OLD)->'plan' THEN RAISE EXCEPTION 'Plan is immutable once persisted' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='conversation_turns' AND to_jsonb(OLD)->>'status'='completed' THEN RAISE EXCEPTION 'Turn already completed' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='tool_executions' AND to_jsonb(OLD)->>'status'='completed' THEN RAISE EXCEPTION 'Tool slot already completed' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='conversations' AND (to_jsonb(NEW)->>'automation_epoch')::bigint<(to_jsonb(OLD)->>'automation_epoch')::bigint THEN RAISE EXCEPTION 'Automation epoch cannot decrease' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION app.cart_item_delete_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $$ DECLARE cart_status text; BEGIN
 SELECT status INTO cart_status FROM app.carts WHERE business_id=OLD.business_id AND id=OLD.cart_id FOR UPDATE;
 IF cart_status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'Only active cart items can be removed' USING ERRCODE='23514'; END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER cart_item_delete_guard BEFORE DELETE ON app.cart_items FOR EACH ROW EXECUTE FUNCTION app.cart_item_delete_guard();
-- Assignee check needs minimal membership lookup; worker is not authorized to alter membership.
GRANT SELECT(business_id,user_id,active,role) ON app.business_memberships TO app_worker;
CREATE POLICY memberships_worker_read ON app.business_memberships FOR SELECT TO app_worker USING(business_id=(SELECT app.tenant_id()) AND active);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['customers','conversations','outbox_events','messages','categories','products','modifier_groups','modifier_options','addresses','delivery_zones','carts','cart_items','orders','order_items','payments','human_handoffs','idempotency_keys','confirmation_challenges','conversation_turns','tool_executions','order_transitions'] LOOP
  EXECUTE format('CREATE TRIGGER a_domain_guard BEFORE INSERT OR UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.domain_guard()',t);
 END LOOP;
END $$;
CREATE FUNCTION app.consume_confirmation_challenge(challenge uuid, customer uuid, hash text, message uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $$ DECLARE changed integer; BEGIN
 UPDATE app.confirmation_challenges c SET consumed_at=clock_timestamp(),confirmation_message_id=message
 FROM app.orders o,app.messages m WHERE c.business_id=(SELECT app.tenant_id()) AND c.id=challenge
 AND c.customer_id=customer AND c.nonce_hash=hash AND c.consumed_at IS NULL AND c.expires_at>clock_timestamp()
 AND o.business_id=c.business_id AND o.id=c.order_id AND o.version=c.order_version AND o.status='awaiting_confirmation'
 AND o.quote_expires_at>clock_timestamp() AND m.business_id=c.business_id AND m.id=message
 AND m.conversation_id=c.conversation_id AND m.direction='inbound' AND m.actor_type='customer' AND m.kind='interactive';
 GET DIAGNOSTICS changed=ROW_COUNT; RETURN changed=1;
END $$;
-- Explicitly revoke public grants even if the migrator has Supabase default privileges.
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SCHEMA app FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='app' AND p.proname IN ('object_shape','json_text','json_integer','coordinates_valid','address_snapshot_valid','opening_hours_valid','option_snapshots_valid','option_ids_valid','polygon_valid','message_content_valid','redacted_valid','plan_valid','outbox_payload_valid','member_of','worker_tenant') LOOP
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO app_api,app_worker',f.signature);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app.consume_confirmation_challenge(uuid,uuid,text,uuid) TO app_worker;
COMMIT;
