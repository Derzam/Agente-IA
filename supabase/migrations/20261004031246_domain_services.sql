-- Phase 4: additive operational capabilities. No passwords or external transports.
BEGIN;
ALTER TABLE app.business_settings DROP CONSTRAINT business_settings_ai_enabled_check;
ALTER TABLE app.business_settings ADD COLUMN tax_policy jsonb CHECK(tax_policy IS NULL OR coalesce((
 app.object_shape(tax_policy,ARRAY['mode','rate_bps','rounding'],ARRAY['mode','rate_bps','rounding'],256)
 AND tax_policy->>'mode' IN ('none','exclusive') AND app.json_integer(tax_policy->'rate_bps',0,10000)
 AND tax_policy->>'rounding'='per_line_half_up' AND (tax_policy->>'mode'<>'none' OR tax_policy->>'rate_bps'='0')),false));
GRANT UPDATE(ai_enabled,tax_policy) ON app.business_settings TO app_api;
ALTER TABLE app.idempotency_keys ADD COLUMN response_body jsonb CHECK(response_body IS NULL OR octet_length(response_body::text)<=1048576);
ALTER TABLE app.carts ADD COLUMN fulfillment text CHECK(fulfillment IN ('pickup','delivery')),
 ADD COLUMN address_snapshot jsonb CHECK(address_snapshot IS NULL OR app.address_snapshot_valid(address_snapshot));
ALTER TABLE app.orders ADD COLUMN quote_fingerprint text CHECK(quote_fingerprint ~ '^[a-f0-9]{64}$');
GRANT UPDATE(fulfillment,address_snapshot) ON app.carts TO app_worker;
GRANT SELECT(id,status,deleted_at,currency,timezone) ON app.businesses TO app_worker;
-- Routing discovery exposes only active business metadata. All job/domain tables retain tenant RLS.
DROP POLICY business_worker_read ON app.businesses;
CREATE POLICY business_worker_read ON app.businesses FOR SELECT TO app_worker USING(status='active' AND deleted_at IS NULL);
GRANT UPDATE(name,timezone,updated_by) ON app.businesses TO app_api;
CREATE POLICY business_api_update ON app.businesses FOR UPDATE TO app_api USING(app.member_of(id,ARRAY['owner','manager'])) WITH CHECK(app.member_of(id,ARRAY['owner','manager']));

-- A trigger-maintained, minimal assignee lookup avoids recursive membership RLS.
-- Memberships remain the authority; no runtime can alter either memberships or this projection.
CREATE TABLE app.handoff_assignees (
 business_id uuid NOT NULL, user_id uuid NOT NULL, active boolean NOT NULL,
 PRIMARY KEY(business_id,user_id),
 FOREIGN KEY(business_id,user_id) REFERENCES app.business_memberships(business_id,user_id) ON DELETE RESTRICT);
INSERT INTO app.handoff_assignees SELECT business_id,user_id,active FROM app.business_memberships;
ALTER TABLE app.handoff_assignees ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.handoff_assignees FORCE ROW LEVEL SECURITY;
CREATE FUNCTION app.sync_handoff_assignee() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
 BEGIN INSERT INTO app.handoff_assignees(business_id,user_id,active) VALUES(NEW.business_id,NEW.user_id,NEW.active)
 ON CONFLICT(business_id,user_id) DO UPDATE SET active=excluded.active; RETURN NEW; END $$;
CREATE TRIGGER membership_assignee_sync AFTER INSERT OR UPDATE ON app.business_memberships FOR EACH ROW EXECUTE FUNCTION app.sync_handoff_assignee();
GRANT SELECT ON app.handoff_assignees TO app_api,app_worker;
CREATE POLICY assignee_api_read ON app.handoff_assignees FOR SELECT TO app_api USING(app.member_of(business_id,ARRAY['owner','manager','operator']));
CREATE POLICY assignee_worker_read ON app.handoff_assignees FOR SELECT TO app_worker USING(app.worker_tenant(business_id));

CREATE TABLE app.internal_event_receipts (
 business_id uuid NOT NULL, outbox_id uuid NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(business_id,outbox_id), FOREIGN KEY(business_id,outbox_id) REFERENCES app.outbox_events(business_id,id) ON DELETE RESTRICT);
ALTER TABLE app.internal_event_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.internal_event_receipts FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON app.internal_event_receipts TO app_worker;
CREATE POLICY receipts_worker_read ON app.internal_event_receipts FOR SELECT TO app_worker USING(app.worker_tenant(business_id));
CREATE POLICY receipts_worker_insert ON app.internal_event_receipts FOR INSERT TO app_worker WITH CHECK(app.worker_tenant(business_id));

GRANT SELECT,INSERT ON app.idempotency_keys,app.audit_logs,app.outbox_events,app.order_transitions TO app_api;
CREATE POLICY idem_api_read ON app.idempotency_keys FOR SELECT TO app_api USING(app.member_of(business_id,ARRAY['owner','manager','operator']) AND actor_scope='human:'||(SELECT app.actor_id())::text);
CREATE POLICY idem_api_insert ON app.idempotency_keys FOR INSERT TO app_api WITH CHECK(app.member_of(business_id,ARRAY['owner','manager','operator']) AND actor_scope='human:'||(SELECT app.actor_id())::text);
CREATE POLICY idem_api_update ON app.idempotency_keys FOR UPDATE TO app_api USING(app.member_of(business_id,ARRAY['owner','manager','operator']) AND actor_scope='human:'||(SELECT app.actor_id())::text) WITH CHECK(app.member_of(business_id,ARRAY['owner','manager','operator']) AND actor_scope='human:'||(SELECT app.actor_id())::text);
CREATE POLICY audit_api_read ON app.audit_logs FOR SELECT TO app_api USING(app.member_of(business_id,ARRAY['owner','manager','operator']));
CREATE POLICY audit_api_insert ON app.audit_logs FOR INSERT TO app_api WITH CHECK(app.member_of(business_id,ARRAY['owner','manager','operator']) AND actor_type='human' AND actor_id=(SELECT app.actor_id()));
CREATE POLICY outbox_api_read ON app.outbox_events FOR SELECT TO app_api USING(app.member_of(business_id,ARRAY['owner','manager','operator']));
CREATE POLICY outbox_api_insert ON app.outbox_events FOR INSERT TO app_api WITH CHECK(app.member_of(business_id,ARRAY['owner','manager','operator']));
CREATE POLICY transitions_api_insert ON app.order_transitions FOR INSERT TO app_api WITH CHECK(app.member_of(business_id,ARRAY['owner','manager','operator']) AND actor_type='human' AND actor_id=(SELECT app.actor_id()));
GRANT UPDATE(status,response_redacted,response_status,response_body,resource_id,lease_until,fencing_token,request_hash,expires_at,updated_by) ON app.idempotency_keys TO app_api,app_worker;
GRANT UPDATE(status,cancellation_reason,updated_by) ON app.orders TO app_api;
CREATE POLICY orders_api_update ON app.orders FOR UPDATE TO app_api USING(app.member_of(business_id,ARRAY['owner','manager','operator'])) WITH CHECK(app.member_of(business_id,ARRAY['owner','manager','operator']));
GRANT UPDATE(status,confirmed_at,confirmation_message_id,cancellation_reason,updated_by) ON app.orders TO app_worker;
GRANT UPDATE(status,recorded_by,paid_at,note,updated_by) ON app.payments TO app_api;
CREATE POLICY payments_api_update ON app.payments FOR UPDATE TO app_api USING(app.member_of(business_id,ARRAY['owner','manager']) OR (status='pending' AND app.member_of(business_id,ARRAY['operator']))) WITH CHECK(app.member_of(business_id,ARRAY['owner','manager']) OR (status='cancelled' AND app.member_of(business_id,ARRAY['operator']) AND EXISTS(SELECT 1 FROM app.orders o WHERE o.business_id=payments.business_id AND o.id=payments.order_id AND o.status='cancelled')));
GRANT INSERT ON app.human_handoffs,app.messages TO app_api;
GRANT UPDATE(status,assigned_user_id,resolved_at,resolution,updated_by) ON app.human_handoffs TO app_api;
GRANT UPDATE(status,automation_epoch,updated_by) ON app.conversations TO app_api;
CREATE POLICY handoff_api_insert ON app.human_handoffs FOR INSERT TO app_api WITH CHECK(app.member_of(business_id,ARRAY['owner','manager','operator']));
CREATE POLICY handoff_api_update ON app.human_handoffs FOR UPDATE TO app_api USING(app.member_of(business_id,ARRAY['owner','manager','operator'])) WITH CHECK(app.member_of(business_id,ARRAY['owner','manager','operator']));
CREATE POLICY conversation_api_update ON app.conversations FOR UPDATE TO app_api USING(app.member_of(business_id,ARRAY['owner','manager','operator'])) WITH CHECK(app.member_of(business_id,ARRAY['owner','manager','operator']));
CREATE POLICY message_api_insert ON app.messages FOR INSERT TO app_api WITH CHECK(app.member_of(business_id,ARRAY['owner','manager','operator']) AND direction='outbound' AND actor_type='human' AND delivery_status='pending');

CREATE FUNCTION app.order_command_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
 DECLARE cmd text:=current_setting('app.order_action',true); BEGIN
 IF NEW.status=OLD.status THEN RETURN NEW; END IF;
 IF pg_has_role(current_user,'app_api','member') THEN
  IF NOT app.member_of(NEW.business_id,ARRAY['owner','manager','operator']) OR NOT coalesce((
   (cmd='accept' AND OLD.status='confirmed' AND NEW.status='accepted') OR
   (cmd='start_preparation' AND OLD.status='accepted' AND NEW.status='preparing') OR
   (cmd='mark_ready' AND OLD.status='preparing' AND NEW.status='ready') OR
   (cmd='dispatch' AND OLD.status='ready' AND NEW.fulfillment='delivery' AND NEW.status='out_for_delivery') OR
   (cmd='complete' AND NEW.status='delivered' AND ((OLD.status='ready' AND NEW.fulfillment='pickup') OR OLD.status='out_for_delivery')) OR
   (cmd='cancel' AND NEW.status='cancelled' AND (OLD.status IN ('awaiting_confirmation','confirmed') OR app.member_of(NEW.business_id,ARRAY['owner','manager'])))
  ),false) THEN RAISE EXCEPTION 'Invalid or unauthorized order command' USING ERRCODE='23514'; END IF;
 ELSIF pg_has_role(current_user,'app_worker','member') THEN
  IF OLD.status<>'awaiting_confirmation' OR NOT coalesce((cmd='confirm' AND NEW.status='confirmed') OR (cmd='cancel' AND NEW.status='cancelled' AND NEW.cancellation_reason IN ('QUOTE_CHANGED','QUOTE_EXPIRED')),false) THEN
   RAISE EXCEPTION 'Worker may only confirm verified proposals' USING ERRCODE='23514'; END IF;
 END IF; RETURN NEW; END $$;
CREATE TRIGGER b_order_command_guard BEFORE UPDATE ON app.orders FOR EACH ROW EXECUTE FUNCTION app.order_command_guard();
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC,anon,authenticated,service_role;
-- Existing helper grants survive the PUBLIC-only revocation above.
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
CREATE OR REPLACE FUNCTION app.consume_confirmation_challenge(challenge uuid, customer uuid, hash text, message uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $$ DECLARE changed integer; BEGIN
 UPDATE app.confirmation_challenges c SET consumed_at=clock_timestamp(),confirmation_message_id=message
 FROM app.orders o,app.messages m WHERE c.business_id=(SELECT app.tenant_id()) AND c.id=challenge
 AND c.customer_id=customer AND c.nonce_hash=hash AND c.consumed_at IS NULL AND c.expires_at>clock_timestamp()
 AND o.business_id=c.business_id AND o.id=c.order_id AND o.version=c.order_version AND o.status='awaiting_confirmation'
 AND o.quote_expires_at>clock_timestamp() AND m.business_id=c.business_id AND m.id=message
 AND m.conversation_id=c.conversation_id AND m.direction='inbound' AND m.actor_type='customer' AND m.kind='interactive'
 AND split_part(m.content->>'id',':',1)='confirm' AND split_part(m.content->>'id',':',2)=c.id::text
 AND split_part(m.content->>'id',':',3)='sha256' AND split_part(m.content->>'id',':',4)=c.nonce_hash;
 GET DIAGNOSTICS changed=ROW_COUNT; RETURN changed=1;
END $$;
CREATE FUNCTION app.membership_change_lock() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
 BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('membership:'||NEW.business_id::text||':'||NEW.user_id::text,0)); RETURN NEW; END $$;
CREATE TRIGGER a_membership_change_lock BEFORE UPDATE ON app.business_memberships FOR EACH ROW EXECUTE FUNCTION app.membership_change_lock();
REVOKE ALL ON FUNCTION app.membership_change_lock() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION app.catalog_change_lock() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
 BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('catalog:'||NEW.business_id::text,0)); RETURN NEW; END $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['business_settings','categories','products','modifier_groups','modifier_options','delivery_zones'] LOOP
 EXECUTE format('CREATE TRIGGER aa_catalog_change_lock BEFORE INSERT OR UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.catalog_change_lock()',t); END LOOP; END $$;
REVOKE ALL ON FUNCTION app.catalog_change_lock() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION app.business_pricing_lock() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
 BEGIN IF NEW.currency IS DISTINCT FROM OLD.currency THEN RAISE EXCEPTION 'Business currency is immutable in MVP' USING ERRCODE='23514'; END IF; IF NEW.timezone IS DISTINCT FROM OLD.timezone THEN PERFORM pg_advisory_xact_lock(hashtextextended('catalog:'||NEW.id::text,0)); END IF; RETURN NEW; END $$;
CREATE TRIGGER a_business_pricing_lock BEFORE UPDATE ON app.businesses FOR EACH ROW EXECUTE FUNCTION app.business_pricing_lock();
REVOKE ALL ON FUNCTION app.business_pricing_lock() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION app.payment_command_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
 DECLARE cmd text:=current_setting('app.payment_action',true); BEGIN
 IF OLD.status IN ('paid','cancelled') AND (to_jsonb(NEW)-ARRAY['version','updated_at','updated_by']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','updated_at','updated_by']) THEN RAISE EXCEPTION 'Payment record is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.status<>OLD.status AND NOT coalesce((OLD.status='pending' AND NEW.status='paid' AND cmd='cash_record' AND NEW.recorded_by=(SELECT app.actor_id()) AND app.member_of(NEW.business_id,ARRAY['owner','manager'])) OR (OLD.status='pending' AND NEW.status='cancelled' AND cmd='cancel' AND EXISTS(SELECT 1 FROM app.orders WHERE business_id=NEW.business_id AND id=NEW.order_id AND status='cancelled')),false) THEN RAISE EXCEPTION 'Invalid payment command' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER b_payment_command_guard BEFORE UPDATE ON app.payments FOR EACH ROW EXECUTE FUNCTION app.payment_command_guard();
CREATE FUNCTION app.handoff_command_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
 BEGIN IF TG_OP='INSERT' AND NEW.status<>'pending' THEN RAISE EXCEPTION 'Handoff must start pending' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF NOT coalesce((OLD.status='pending' AND NEW.status='active' AND (NEW.assigned_user_id=(SELECT app.actor_id()) OR app.member_of(NEW.business_id,ARRAY['owner','manager']))) OR (OLD.status='active' AND NEW.status='resolved' AND (OLD.assigned_user_id=(SELECT app.actor_id()) OR app.member_of(NEW.business_id,ARRAY['owner','manager']))),false) THEN RAISE EXCEPTION 'Invalid handoff command' USING ERRCODE='23514'; END IF;
 END IF; RETURN NEW; END $$;
CREATE TRIGGER b_handoff_command_guard BEFORE INSERT OR UPDATE ON app.human_handoffs FOR EACH ROW EXECUTE FUNCTION app.handoff_command_guard();
REVOKE UPDATE(status,assigned_user_id,resolved_at,resolution,updated_by) ON app.human_handoffs FROM app_worker;
CREATE FUNCTION app.catalog_bounds_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
 DECLARE product uuid; BEGIN
 IF TG_TABLE_NAME='modifier_groups' THEN
  IF (SELECT count(*) FROM app.modifier_groups WHERE business_id=NEW.business_id AND product_id=NEW.product_id AND deleted_at IS NULL)>=99 THEN RAISE EXCEPTION 'Group limit' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT product_id INTO product FROM app.modifier_groups WHERE business_id=NEW.business_id AND id=NEW.modifier_group_id;
  IF (SELECT count(*) FROM app.modifier_options WHERE business_id=NEW.business_id AND modifier_group_id=NEW.modifier_group_id AND deleted_at IS NULL)>=99 OR (SELECT count(*) FROM app.modifier_options o JOIN app.modifier_groups g ON g.business_id=o.business_id AND g.id=o.modifier_group_id WHERE g.business_id=NEW.business_id AND g.product_id=product AND g.deleted_at IS NULL AND o.deleted_at IS NULL)>=100 THEN RAISE EXCEPTION 'Option limit' USING ERRCODE='23514'; END IF;
 END IF;RETURN NEW; END $$;
CREATE TRIGGER b_catalog_bounds_guard BEFORE INSERT ON app.modifier_groups FOR EACH ROW EXECUTE FUNCTION app.catalog_bounds_guard();
CREATE TRIGGER b_catalog_bounds_guard BEFORE INSERT ON app.modifier_options FOR EACH ROW EXECUTE FUNCTION app.catalog_bounds_guard();
REVOKE ALL ON FUNCTION app.payment_command_guard(),app.handoff_command_guard(),app.catalog_bounds_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION app.attention_consistency() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
 DECLARE conversation uuid; attention text; handoff text; BEGIN
 IF TG_TABLE_NAME='conversations' THEN conversation:=NEW.id; ELSE conversation:=NEW.conversation_id; END IF;
 SELECT status INTO attention FROM app.conversations WHERE business_id=NEW.business_id AND id=conversation;
 SELECT status INTO handoff FROM app.human_handoffs WHERE business_id=NEW.business_id AND conversation_id=conversation AND status IN ('pending','active');
 IF NOT coalesce((attention IN ('bot_active','closed') AND handoff IS NULL) OR (attention='human_pending' AND handoff='pending') OR (attention='human_active' AND handoff='active'),false) THEN RAISE EXCEPTION 'Conversation/handoff state mismatch' USING ERRCODE='23514'; END IF;RETURN NULL; END $$;
CREATE CONSTRAINT TRIGGER attention_consistency AFTER INSERT OR UPDATE ON app.conversations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.attention_consistency();
CREATE CONSTRAINT TRIGGER attention_consistency AFTER INSERT OR UPDATE ON app.human_handoffs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.attention_consistency();
REVOKE ALL ON FUNCTION app.attention_consistency() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
