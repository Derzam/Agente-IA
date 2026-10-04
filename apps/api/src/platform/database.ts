import pg, { type PoolClient } from 'pg';
import { unavailable } from './errors.js';

export function createPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 3000, idleTimeoutMillis: 30_000, query_timeout: 5000, statement_timeout: 5000, application_name: 'agente-ia-foundation' });
  // Idle-client failures must not crash the process or print connection secrets.
  pool.on('error', () => process.stderr.write(JSON.stringify({level:'error',event_type:'database.idle_client_error'})+'\n'));
  return pool;
}
export async function transaction<T>(pool: pg.Pool, execute: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL synchronous_commit = on");
    const result = await execute(client);
    const committed = await client.query('COMMIT');
    if (committed.command !== 'COMMIT') throw unavailable();
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { broken = true; }
    throw error;
  } finally { client.release(broken); }
}
export async function userContext(client: PoolClient, userId: string, businessId?: string): Promise<void> {
  await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.business_id', $2, true)", [userId, businessId ?? '']);
}
export async function checkDatabaseRole(pool: pg.Pool, kind: 'api' | 'ingress' | 'worker'): Promise<void> {
  const role = `app_${kind}`;
  const forbidden = ['app_api','app_ingress','app_worker'].filter(r=>r!==role);
  const client = await pool.connect();
  try {
    const result = await client.query<{ safe: boolean }>(`
      SELECT NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreaterole AND NOT r.rolcreatedb
        AND pg_has_role(current_user, $1, 'member')
        AND NOT EXISTS(SELECT 1 FROM pg_roles w WHERE w.rolname=ANY($2::text[]) AND pg_has_role(current_user,w.oid,'member'))
        AND NOT EXISTS(SELECT 1 FROM pg_roles other WHERE other.rolname NOT IN (current_user,$1)
          AND pg_has_role(current_user,other.oid,'member'))
        AND NOT has_schema_privilege(current_user,'app','CREATE')
        AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='app' AND pg_has_role(current_user,c.relowner,'member'))
        AND 4=(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='app' AND c.relname IN ('businesses','business_memberships','whatsapp_channels','webhook_events')
            AND c.relrowsecurity AND c.relforcerowsecurity)
        AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='app' AND c.relkind='r' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity))
        AS safe FROM pg_roles r WHERE r.rolname=current_user`, [role, forbidden]);
    if (result.rows[0]?.safe !== true) throw unavailable();
    await client.query('SELECT 1');
  } finally { client.release(); }
}
