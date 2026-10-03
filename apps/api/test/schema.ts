import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export const contract=JSON.parse(readFileSync(new URL('../../../docs/api/openapi.json',import.meta.url),'utf8'));
const ajv=new Ajv2020({strict:true});
const formats=addFormats as unknown as (validator:Ajv2020)=>void;formats(ajv);
const bundle=JSON.parse(JSON.stringify({$id:'contract',$defs:contract.components.schemas}).replaceAll('#/components/schemas/','#/$defs/'));
ajv.addSchema(bundle);
export function assertContract(name:string,body:unknown){
  const validate=ajv.compile({$ref:`contract#/$defs/${name}`});assert.ok(validate(body),JSON.stringify(validate.errors));
}
export function assertSchema(schema:object,body:unknown){assert.ok(ajv.compile(schema)(body));}
export function compileAllSchemas(){for(const name of Object.keys(contract.components.schemas))ajv.compile({$ref:`contract#/$defs/${name}`});}
