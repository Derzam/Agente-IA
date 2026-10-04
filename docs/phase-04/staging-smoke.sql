-- Run inside the rollback validation transaction, or BEGIN/ROLLBACK after migration.
-- Metadata only; no tenant/customer fixtures, credentials or provider calls.
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='app' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity)<>29 THEN
  RAISE EXCEPTION 'Expected 29 ENABLE/FORCE RLS tables'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='app' AND (p.prosecdef OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0))) THEN
  RAISE EXCEPTION 'Privileged/public function found'; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='app'
  AND grantee IN ('PUBLIC','anon','authenticated','service_role')) THEN
  RAISE EXCEPTION 'Platform table grant found'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('app_api','app_ingress','app_worker')
  AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolcanlogin)) THEN
  RAISE EXCEPTION 'Elevated runtime role found'; END IF;
 IF has_column_privilege('app_api','app.orders','confirmed_at','UPDATE')
  OR has_table_privilege('app_api','app.confirmation_challenges','SELECT')
  OR has_column_privilege('app_worker','app.products','price_minor','UPDATE')
  OR has_column_privilege('app_ingress','app.orders','status','UPDATE') THEN
  RAISE EXCEPTION 'Unexpected runtime capability'; END IF;
 IF NOT has_column_privilege('app_api','app.idempotency_keys','response_body','UPDATE')
  OR NOT has_column_privilege('app_api','app.business_settings','ai_enabled','UPDATE') THEN
  RAISE EXCEPTION 'Missing operational capability'; END IF;
END $$;
SELECT count(*)::integer AS forced_rls_tables FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='app' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity;
