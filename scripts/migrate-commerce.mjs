import {Pool} from 'pg';
import {readFile} from 'node:fs/promises';
import {databaseUrl} from '../utils/environment.ts';
if(!databaseUrl)throw Error('DATABASE_URL required');
const pool=new Pool({connectionString:databaseUrl,max:1}),client=await pool.connect();
try{
 await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('payment-commerce-migration'))");
 for(const name of ['20261020-refund-idempotency','20261030-commerce-delivery','20261030-return-sync']){
  const source=(await readFile(new URL('../database/migrations/'+name+'.sql',import.meta.url),'utf8')).replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'');
  await client.query(source);
 }
 await client.query('COMMIT');console.log('Payment Commerce delivery and refund migrations applied.');
}catch(e){await client.query('ROLLBACK');console.error('Payment migration rolled back',{code:e.code??'migration_failed'});process.exitCode=1}finally{client.release();await pool.end()}
