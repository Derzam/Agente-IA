-- Additive staging runtime; no credentials or LOGIN principals.
BEGIN;
ALTER TABLE app.confirmation_challenges ADD COLUMN transport_cipher jsonb CHECK(transport_cipher IS NULL OR coalesce(
 app.object_shape(transport_cipher,ARRAY['key_version','iv','ciphertext','tag'],ARRAY['key_version','iv','ciphertext','tag'],2048)
 AND transport_cipher->>'key_version' ~ '^[A-Za-z0-9_-]{1,24}$' AND transport_cipher->>'iv' ~ '^[A-Za-z0-9_-]{16}$'
 AND transport_cipher->>'tag' ~ '^[A-Za-z0-9_-]{22}$' AND transport_cipher->>'ciphertext' ~ '^[A-Za-z0-9_-]+$' AND length(transport_cipher->>'ciphertext') BETWEEN 1 AND 1024,false));
CREATE UNIQUE INDEX challenge_transport_iv ON app.confirmation_challenges((transport_cipher->>'key_version'),(transport_cipher->>'iv')) WHERE transport_cipher IS NOT NULL;
ALTER TABLE app.messages ADD COLUMN confirmation_challenge_id uuid,
 ADD CONSTRAINT message_confirmation_transport_fk FOREIGN KEY(business_id,confirmation_challenge_id) REFERENCES app.confirmation_challenges(business_id,id) ON DELETE RESTRICT;
CREATE INDEX message_confirmation_transport_idx ON app.messages(business_id,confirmation_challenge_id);
ALTER TABLE app.outbox_events ADD COLUMN transport_started_at timestamptz, ADD COLUMN accepted_at timestamptz,
 ADD COLUMN delivery_status text CHECK(delivery_status IN ('sent','delivered','read','failed')),
 ADD COLUMN provider_status_at timestamptz, ADD COLUMN last_error_code text CHECK(last_error_code ~ '^[A-Z0-9_]{1,120}$');
ALTER TABLE app.conversation_turns ADD COLUMN provider text CHECK(provider='openai'), ADD COLUMN model text CHECK(model ~ '^[A-Za-z0-9._:-]{1,120}$'),
 ADD COLUMN started_at timestamptz, ADD COLUMN completed_at timestamptz,
 ADD COLUMN input_tokens bigint NOT NULL DEFAULT 0 CHECK(input_tokens>=0), ADD COLUMN output_tokens bigint NOT NULL DEFAULT 0 CHECK(output_tokens>=0),
 ADD COLUMN responses integer NOT NULL DEFAULT 0 CHECK(responses>=0), ADD COLUMN tool_calls integer NOT NULL DEFAULT 0 CHECK(tool_calls BETWEEN 0 AND 32),
 ADD COLUMN error_code text CHECK(error_code ~ '^[A-Z0-9_]{1,120}$');
CREATE UNIQUE INDEX turn_active_slot ON app.conversation_turns(business_id,conversation_id) WHERE status IN ('pending','planned');
ALTER TABLE app.tool_executions DROP CONSTRAINT tool_executions_tool_name_check;
ALTER TABLE app.tool_executions ADD CONSTRAINT tool_executions_tool_name_check CHECK(tool_name IN
 ('get_menu','search_products','get_product_details','add_cart_item','remove_cart_item','get_cart','set_delivery_address','calculate_delivery','create_order','confirm_order','request_human_agent',
 'search_menu','get_product','add_to_cart','remove_from_cart','set_fulfillment','request_quote','request_human'));
ALTER TABLE app.tool_executions DROP CONSTRAINT tool_executions_action_index_check;
ALTER TABLE app.tool_executions ADD CONSTRAINT tool_executions_action_index_check CHECK(action_index BETWEEN 0 AND 31);
ALTER TABLE app.tool_executions ADD COLUMN duration_ms integer CHECK(duration_ms>=0), ADD COLUMN error_code text CHECK(error_code ~ '^[A-Z0-9_]{1,120}$');
CREATE TABLE app.runtime_windows (
 business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,kind text NOT NULL CHECK(kind IN ('ai','admin','inbound','outbound')),
 scope text NOT NULL CHECK(length(scope) BETWEEN 1 AND 120), window_start timestamptz NOT NULL,
 input_tokens bigint NOT NULL DEFAULT 0 CHECK(input_tokens>=0),output_tokens bigint NOT NULL DEFAULT 0 CHECK(output_tokens>=0),
 responses bigint NOT NULL DEFAULT 0 CHECK(responses>=0),tools bigint NOT NULL DEFAULT 0 CHECK(tools>=0),count bigint NOT NULL DEFAULT 0 CHECK(count>=0),
 PRIMARY KEY(business_id,kind,scope,window_start));
CREATE TABLE app.provider_circuits (
 business_id uuid NOT NULL REFERENCES app.businesses(id) ON DELETE RESTRICT,provider text NOT NULL CHECK(provider IN ('openai','meta')),
 state text NOT NULL DEFAULT 'closed' CHECK(state IN ('closed','open','half_open')),failures integer NOT NULL DEFAULT 0 CHECK(failures>=0),retry_at timestamptz,probe_until timestamptz,
 PRIMARY KEY(business_id,provider));
CREATE TABLE app.ingress_rate_windows (key_hash text NOT NULL CHECK(key_hash ~ '^[a-f0-9]{64}$'),window_start timestamptz NOT NULL,count integer NOT NULL CHECK(count>=0),PRIMARY KEY(key_hash,window_start));
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['runtime_windows','provider_circuits','ingress_rate_windows'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);END LOOP;END $$;
GRANT SELECT,INSERT ON app.runtime_windows TO app_worker,app_api;
GRANT UPDATE(input_tokens,output_tokens,responses,tools,count) ON app.runtime_windows TO app_worker;
GRANT UPDATE(count) ON app.runtime_windows TO app_api;
CREATE POLICY runtime_worker_read ON app.runtime_windows FOR SELECT TO app_worker USING(app.worker_tenant(business_id));
CREATE POLICY runtime_worker_insert ON app.runtime_windows FOR INSERT TO app_worker WITH CHECK(app.worker_tenant(business_id));
CREATE POLICY runtime_worker_update ON app.runtime_windows FOR UPDATE TO app_worker USING(app.worker_tenant(business_id)) WITH CHECK(app.worker_tenant(business_id));
CREATE POLICY runtime_api_read ON app.runtime_windows FOR SELECT TO app_api USING(kind='admin' AND scope=(SELECT app.actor_id())::text AND app.member_of(business_id,ARRAY['owner','manager','operator']));
CREATE POLICY runtime_api_insert ON app.runtime_windows FOR INSERT TO app_api WITH CHECK(kind='admin' AND scope=(SELECT app.actor_id())::text AND app.member_of(business_id,ARRAY['owner','manager','operator']) AND input_tokens=0 AND output_tokens=0 AND responses=0 AND tools=0);
CREATE POLICY runtime_api_update ON app.runtime_windows FOR UPDATE TO app_api USING(kind='admin' AND scope=(SELECT app.actor_id())::text AND app.member_of(business_id,ARRAY['owner','manager','operator'])) WITH CHECK(kind='admin' AND scope=(SELECT app.actor_id())::text AND app.member_of(business_id,ARRAY['owner','manager','operator']));
GRANT SELECT,INSERT ON app.provider_circuits TO app_worker;
GRANT UPDATE(state,failures,retry_at,probe_until) ON app.provider_circuits TO app_worker;
CREATE POLICY circuit_worker_read ON app.provider_circuits FOR SELECT TO app_worker USING(app.worker_tenant(business_id));
CREATE POLICY circuit_worker_insert ON app.provider_circuits FOR INSERT TO app_worker WITH CHECK(app.worker_tenant(business_id));
CREATE POLICY circuit_worker_update ON app.provider_circuits FOR UPDATE TO app_worker USING(app.worker_tenant(business_id)) WITH CHECK(app.worker_tenant(business_id));
GRANT SELECT,INSERT ON app.ingress_rate_windows TO app_ingress;
GRANT UPDATE(count) ON app.ingress_rate_windows TO app_ingress;
CREATE POLICY ingress_rate_read ON app.ingress_rate_windows FOR SELECT TO app_ingress USING(true);
CREATE POLICY ingress_rate_insert ON app.ingress_rate_windows FOR INSERT TO app_ingress WITH CHECK(true);
CREATE POLICY ingress_rate_update ON app.ingress_rate_windows FOR UPDATE TO app_ingress USING(true) WITH CHECK(true);
GRANT UPDATE(transport_cipher) ON app.confirmation_challenges TO app_worker;
GRANT UPDATE(provider_message_id,provider_timestamp,delivery_status) ON app.messages TO app_worker;
GRANT UPDATE(transport_started_at,accepted_at,delivery_status,provider_status_at,last_error_code,provider_message_id) ON app.outbox_events TO app_worker;
GRANT UPDATE(provider,model,started_at,completed_at,input_tokens,output_tokens,responses,tool_calls,error_code) ON app.conversation_turns TO app_worker;
GRANT UPDATE(duration_ms,error_code) ON app.tool_executions TO app_worker;
REVOKE ALL ON app.runtime_windows,app.provider_circuits,app.ingress_rate_windows FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION app.runtime_plan_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 DECLARE a jsonb;BEGIN
 IF NOT coalesce(app.object_shape(v,ARRAY['actions'],ARRAY['actions'],16384),false) OR jsonb_typeof(v->'actions') IS DISTINCT FROM 'array' OR jsonb_array_length(v->'actions')>32 THEN RETURN false;END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(v->'actions') LOOP
 IF NOT coalesce(app.object_shape(a,ARRAY['tool_name','arguments_hash'],ARRAY['tool_name','arguments_hash'],256) AND a->>'tool_name' IN ('search_menu','get_product','get_cart','add_to_cart','remove_from_cart','set_fulfillment','request_quote','confirm_order','request_human') AND a->>'arguments_hash' ~ '^[a-f0-9]{64}$',false) THEN RETURN false;END IF;END LOOP;RETURN true;END $$;
REVOKE ALL ON FUNCTION app.runtime_plan_valid(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app.runtime_plan_valid(jsonb) TO app_worker;
ALTER TABLE app.conversation_turns ADD COLUMN runtime_plan jsonb CHECK(runtime_plan IS NULL OR app.runtime_plan_valid(runtime_plan));
GRANT UPDATE(runtime_plan) ON app.conversation_turns TO app_worker;
CREATE FUNCTION app.runtime_plan_append_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
 BEGIN IF NEW.runtime_plan IS DISTINCT FROM OLD.runtime_plan THEN
 IF NOT coalesce(NEW.provider='openai' AND OLD.status='pending' AND NEW.status='pending' AND OLD.lease_until>clock_timestamp()
 AND jsonb_array_length(NEW.runtime_plan->'actions')=jsonb_array_length(OLD.runtime_plan->'actions')+1
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.runtime_plan->'actions') WITH ORDINALITY a(v,i) WHERE NEW.runtime_plan->'actions'->(a.i::integer-1) IS DISTINCT FROM a.v)
 AND EXISTS(SELECT 1 FROM app.conversations c JOIN app.business_settings s ON s.business_id=c.business_id WHERE c.business_id=NEW.business_id AND c.id=NEW.conversation_id AND c.status='bot_active' AND c.automation_epoch=NEW.automation_epoch AND s.ai_enabled),false)
 THEN RAISE EXCEPTION 'Runtime slots are immutable and may only append under current epoch' USING ERRCODE='23514';END IF;END IF;RETURN NEW;END $$;
REVOKE ALL ON FUNCTION app.runtime_plan_append_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER b_runtime_plan_append_guard BEFORE UPDATE ON app.conversation_turns FOR EACH ROW EXECUTE FUNCTION app.runtime_plan_append_guard();

CREATE OR REPLACE FUNCTION app.domain_guard() RETURNS trigger
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
 IF TG_TABLE_NAME='human_handoffs' AND to_jsonb(NEW)->>'status'='active' AND to_jsonb(NEW)->>'assigned_user_id' IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM app.handoff_assignees WHERE business_id=NEW.business_id AND user_id=NEW.assigned_user_id AND active) THEN RAISE EXCEPTION 'Inactive handoff assignee' USING ERRCODE='23514'; END IF;
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
   IF NEW.status='confirmed' AND OLD.status='awaiting_confirmation' THEN
    IF NOT EXISTS(
     SELECT 1 FROM app.confirmation_challenges c WHERE c.business_id=NEW.business_id AND c.order_id=NEW.id
      AND c.customer_id=NEW.customer_id AND c.order_version=OLD.version AND c.consumed_at IS NOT NULL
      AND c.confirmation_message_id=NEW.confirmation_message_id AND c.expires_at>clock_timestamp()
   ) THEN RAISE EXCEPTION 'Verified challenge required' USING ERRCODE='23514'; END IF;
   END IF;
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
  SELECT CASE WHEN provider='openai' THEN runtime_plan ELSE plan END AS plan INTO row_data FROM app.conversation_turns WHERE business_id=NEW.business_id AND id=NEW.turn_id;
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
  IF TG_TABLE_NAME='outbox_events' AND to_jsonb(OLD)->>'status' IN ('unknown','sent') AND to_jsonb(NEW)->>'status'<>to_jsonb(OLD)->>'status' THEN
 IF NOT coalesce(to_jsonb(OLD)->>'status'='unknown' AND to_jsonb(NEW)->>'status'='sent' AND to_jsonb(NEW)->>'provider_message_id' IS NOT NULL AND to_jsonb(OLD)->>'transport_started_at' IS NOT NULL AND current_setting('app.meta_reconcile',true)='verified',false) THEN RAISE EXCEPTION 'No blind resend of unknown or sent outbox' USING ERRCODE='23514'; END IF;
 END IF;
  IF TG_TABLE_NAME='confirmation_challenges' AND to_jsonb(OLD)->>'consumed_at' IS NOT NULL THEN RAISE EXCEPTION 'Challenge already consumed' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='conversation_turns' AND to_jsonb(OLD)->>'plan' IS NOT NULL AND to_jsonb(NEW)->'plan' IS DISTINCT FROM to_jsonb(OLD)->'plan' THEN RAISE EXCEPTION 'Plan is immutable once persisted' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='conversation_turns' AND to_jsonb(OLD)->>'status'='completed' THEN RAISE EXCEPTION 'Turn already completed' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='tool_executions' AND to_jsonb(OLD)->>'status'='completed' THEN RAISE EXCEPTION 'Tool slot already completed' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='conversations' AND (to_jsonb(NEW)->>'automation_epoch')::bigint<(to_jsonb(OLD)->>'automation_epoch')::bigint THEN RAISE EXCEPTION 'Automation epoch cannot decrease' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
COMMIT;
