// Never uses DATABASE_URL: tests require a disposable loopback *_test DB.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, access, realpath, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import pg from 'pg';

const root = fileURLToPath(new URL('../', import.meta.url));
async function run(command, args, env = process.env, silent = false) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd:root, env, windowsHide:true, stdio:silent ? ['ignore','pipe','pipe'] : 'inherit' });
    let diagnostic='';
    if (silent) {
      child.stdout.on('data',chunk=>{diagnostic=(diagnostic+chunk.toString()).slice(-4000);});
      child.stderr.on('data',chunk=>{diagnostic=(diagnostic+chunk.toString()).slice(-4000);});
    }
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolvePromise() : reject(new Error(`Subprocess failed (exit ${code}); command=${command}${silent?'\n'+diagnostic:''}`)));
  });
}
let cluster;
let pgCtl;
let started = false;
try {
  let testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    const bin = process.env.PG_BIN ?? (process.platform === 'win32' ? 'C:\\Program Files\\PostgreSQL\\17\\bin' : '/usr/lib/postgresql/17/bin');
    const executable = name => join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
    await access(executable('initdb'));
    cluster = await mkdtemp(join(tmpdir(), 'agente-ia-pg-'));
    pgCtl = executable('pg_ctl');
    await run(executable('initdb'), ['-D',cluster,'-U','postgres','-A','trust','--no-locale','--encoding=UTF8'],process.env,true);
    const port = await new Promise((resolvePort,reject) => {
      const probe = createServer(); probe.on('error',reject);
      probe.listen(0,'127.0.0.1',() => { const address = probe.address(); if (!address || typeof address === 'string') return reject(new Error('Port unavailable')); probe.close(() => resolvePort(address.port)); });
    });
    await run(pgCtl,['-D',cluster,'-l',join(cluster,'test-server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','-t','15','start'],process.env,true);
    started = true;
    const admin = new pg.Pool({ host:'127.0.0.1',port:Number(port),user:'postgres',database:'postgres' });
    try { await admin.query('CREATE DATABASE agente_ia_test'); } finally { await admin.end(); }
    testUrl = `postgres://postgres@127.0.0.1:${port}/agente_ia_test`;
    console.log('PostgreSQL isolated temporary cluster started (loopback only).');
  }
  const testFiles=(await readdir(join(root,'apps/api/test'))).filter(name=>name.endsWith('.test.ts')).map(name=>join(root,'apps/api/test',name));
  // DB suites use separate databases but capability roles belong to the cluster.
  await run(process.execPath, ['--import','tsx','--test','--test-concurrency=1',...testFiles], { ...process.env, TEST_DATABASE_URL:testUrl });
} catch (error) {
  // URLs and child stderr may contain credentials; emit only a safe diagnostic.
  console.error(error?.message?.startsWith('Subprocess failed') ? error.message : 'Tests could not start. Set PG_BIN or a disposable loopback TEST_DATABASE_URL ending in _test.');
  process.exitCode = 1;
} finally {
  if (started) await run(pgCtl,['-D',cluster,'-m','fast','-w','-t','15','stop'],process.env,true).catch(() => { process.exitCode = 1; });
  if (cluster && !process.exitCode) {
    const actual = await realpath(cluster);
    const parent = await realpath(tmpdir());
    if (!actual.startsWith(parent + sep) || !actual.slice(parent.length+1).startsWith('agente-ia-pg-') || resolve(actual) === resolve(parent)) throw new Error('Unsafe temporary cluster cleanup path');
    await rm(actual,{recursive:true,force:true});
  }
}
