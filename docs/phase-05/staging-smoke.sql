-- Metadata-only assertions. Run in a BEGIN/ROLLBACK transaction; no fixtures or credentials.
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='app' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity)<>32 THEN
  RAISE EXCEPTION 'Expected 32 ENABLE/FORCE RLS tables'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='app' AND (p.prosecdef OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0))) THEN
  RAISE EXCEPTION 'Privileged/public function found'; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='app'
  AND grantee IN ('PUBLIC','anon','authenticated','service_role')) THEN
  RAISE EXCEPTION 'Platform table grant found'; END IF;
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('app_api','app_ingress','app_worker'))<>3
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('app_api','app_ingress','app_worker')
  AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolcanlogin)) THEN
  RAISE EXCEPTION 'Unexpected capability role'; END IF;
 IF has_column_privilege('app_api','app.orders','confirmed_at','UPDATE')
  OR has_table_privilege('app_api','app.confirmation_challenges','SELECT')
  OR has_column_privilege('app_worker','app.products','price_minor','UPDATE')
  OR has_column_privilege('app_ingress','app.orders','status','UPDATE')
  OR has_table_privilege('app_api','app.provider_circuits','SELECT')
  OR has_table_privilege('app_worker','app.ingress_rate_windows','UPDATE') THEN
  RAISE EXCEPTION 'Unexpected runtime capability'; END IF;
 IF NOT has_column_privilege('app_worker','app.confirmation_challenges','transport_cipher','UPDATE')
  OR NOT has_column_privilege('app_worker','app.conversation_turns','runtime_plan','UPDATE')
  OR NOT has_column_privilege('app_worker','app.outbox_events','provider_message_id','UPDATE')
  OR NOT has_column_privilege('app_api','app.runtime_windows','count','UPDATE')
  OR NOT has_column_privilege('app_ingress','app.ingress_rate_windows','count','UPDATE') THEN
  RAISE EXCEPTION 'Missing runtime capability'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='app.conversation_turns'::regclass
  AND tgname='b_runtime_plan_append_guard' AND NOT tgisinternal) THEN
  RAISE EXCEPTION 'Missing approved-slot guard'; END IF;
 IF app.runtime_plan_valid('{"actions":[{"tool_name":"execute_sql","arguments_hash":"invalid"}]}'::jsonb)
  OR NOT app.runtime_plan_valid('{"actions":[]}'::jsonb) THEN
  RAISE EXCEPTION 'Invalid tool allowlist'; END IF;
END $$;
SELECT count(*)::integer AS forced_rls_tables FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='app' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity;
