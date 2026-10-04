// Comprobaciones estáticas de artefactos; no son tests del backend.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = p => readFileSync(resolve(root,p),'utf8');
const doc = JSON.parse(read('docs/api/openapi.json'));
assert.equal(doc.openapi,'3.1.0');
assert.match(doc.info.description,/Fase 4/);
assert.equal(doc.servers,undefined,'No declarar un servidor ficticio operativo');
function walk(value) {
  if (!value || typeof value !== 'object') return;
  if (value.$ref) {
    assert.ok(value.$ref.startsWith('#/'),'Solo referencias locales');
    const resolved = value.$ref.slice(2).split('/').reduce((v,k) => v?.[k],doc);
    assert.ok(resolved,`Referencia ausente: ${value.$ref}`);
  }
  if (value.type === 'object' && value.properties && value.additionalProperties === false) {
    for (const key of value.required || []) assert.ok(key in value.properties,`Required sin propiedad: ${key}`);
  }
  for (const child of Object.values(value)) walk(child);
}
walk(doc);
const ids = new Set();
let operations = 0;
for (const [path,item] of Object.entries(doc.paths)) {
  for (const [method,op] of Object.entries(item)) {
    operations++;
    assert.ok(!ids.has(op.operationId),`operationId duplicado: ${op.operationId}`); ids.add(op.operationId);
    assert.ok(op.responses,'Responses obligatorio');
    for (const match of path.matchAll(/\{([^}]+)\}/g)) assert.ok(op.parameters.some(p => p.in === 'path' && p.name === match[1] && p.required));
    if (path.startsWith('/v1/')) {
      assert.deepEqual(op.security,[{supabaseBearer:[]}]);
      assert.ok(op['x-roles'].length);
      for (const code of ['401','403','404','409','422','429','500','503']) assert.ok(op.responses[code]);
      if (method !== 'get') assert.ok(op.parameters.some(p => p.name === 'Idempotency-Key' && p.required));
      if (method === 'delete') {
        assert.ok(op.parameters.some(p => p.name === 'expected_version' && p.required));
        assert.equal(op.responses['204'].content,undefined);
      }
      if (method === 'patch') {
        const name = op.requestBody.content['application/json'].schema.$ref.split('/').at(-1);
        assert.ok(doc.components.schemas[name].required.includes('expected_version'));
      }
    }
  }
}
assert.equal(operations,49,'41 anteriores + 8 rutas jerárquicas de modificadores');
assert.equal(Object.values(doc.paths).flatMap(item=>Object.values(item)).filter(op=>op['x-implementation-status']==='IMPLEMENTED').length,49);
const ts = read('packages/shared/src/index.ts');
for (const name of ['Role','OrderStatus','OrderAction','ConversationStatus','HandoffReason','ErrorCode','DomainEventType']) {
  const declaration = ts.match(new RegExp(`export type ${name} = ([^;]+);`));
  assert.ok(declaration,`Falta type ${name}`);
  const values = [...declaration[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.deepEqual(values,doc.components.schemas[name].enum,`Enum divergente: ${name}`);
}
// Verificar catálogo HTTP documental contra rutas generadas.
const contracts = read('docs/api/contracts.md');
let documented = 0;
for (const match of contracts.matchAll(/^\| (GET|POST|PATCH|DELETE) (\S+) \|/gm)) {
  const method = match[1].toLowerCase();
  const suffix = match[2];
  const path = suffix === 'base' ? '/v1/businesses/{business_id}' : suffix.startsWith('/v1/') ? suffix : '/v1/businesses/{business_id}' + suffix;
  assert.ok(doc.paths[path]?.[method],`Ruta documental ausente: ${method} ${path}`);
  documented++;
}
assert.equal(documented,operations-4,'Todo endpoint admin debe estar documentado; webhook y probes separados');
function files(dir) { return readdirSync(dir,{withFileTypes:true}).flatMap(e => e.isDirectory() ? files(resolve(dir,e.name)) : [resolve(dir,e.name)]); }
const markdownFiles = [resolve(root,'README.md'), ...files(resolve(root,'docs')).filter(p => p.endsWith('.md')), resolve(root,'packages/shared/README.md')];
for (const path of markdownFiles) {
  const markdown = readFileSync(path,'utf8');
  for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const link = match[1];
    if (/^https?:|^#/.test(link)) continue;
    assert.ok(existsSync(resolve(dirname(path),link.split('#')[0])),`Link roto ${relative(root,path)} → ${link}`);
  }
}
const allowedValues = { NODE_ENV:'development', PORT:'3000' };
for (const line of read('.env.example').split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue;
  const [key,...rest] = line.split('=');
  assert.equal(rest.join('='),allowedValues[key] || '',`Valor real/no permitido en .env.example: ${key}`);
}
// Sin imprimir contenido potencialmente sensible. Escaneo heurístico, no prueba exhaustiva.
const candidateFiles = [...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean))].map(p => resolve(root,p));
const signatures = [/sk-[A-Za-z0-9_-]{20,}/, /gh[pousr]_[A-Za-z0-9]{20,}/, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /postgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@/, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/];
for (const path of candidateFiles) for (const pattern of signatures) assert.ok(!pattern.test(readFileSync(path,'utf8')),`Posible secreto en ${relative(root,path)}`);
console.log(`OK: ${operations} operaciones, referencias OpenAPI, 7 enums, ${documented} rutas admin, ${markdownFiles.length} documentos y valores de entorno/escaneo heurístico.`);
