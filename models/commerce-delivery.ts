import { clientCredentialsTokenRequest } from 'better-auth/oauth2';
import { pool } from '@/database';
import { commerceDeliveryTable,type Payment } from '@/database/schema';
import { isCommerceOrder,managedCommerceOrigin } from '@/services/commerce-order';
import { authUrl,oauthClientId,oauthClientSecret,isProduction } from '@/utils/environment';
import { ServiceError } from '@/lib/errors';
import type { database } from '@/database';
type Tx=Parameters<Parameters<typeof database.transaction>[0]>[0];
export async function rawEnqueueCommerce(tx:Tx,p:Payment,kind:'capture'|'failed'|'refund',amount=p.amount,refund:{returnId?:string;refundId?:string;refundMinor?:number}={}){
  if(!isCommerceOrder(p))return;
  await tx.insert(commerceDeliveryTable).values({id:p.id+':'+kind+':'+amount,paymentId:p.id,orderId:p.referenceId,kind,amountMinor:amount,currency:p.currency,...refund}).onConflictDoNothing();
}
async function machineToken(){
  if(!authUrl||!oauthClientId||!oauthClientSecret)throw new ServiceError('payment_backend_oauth_not_configured',503);
  const u=new URL(authUrl);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||(u.protocol!=='https:'&&(isProduction||u.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(u.hostname))))throw new ServiceError('invalid_auth_configuration',503);
  const tokenEndpoint=new URL('/auth/oauth2/token',u).href;
  const r=await clientCredentialsTokenRequest({options:{clientId:oauthClientId,clientSecret:oauthClientSecret},tokenEndpoint,tokenEndpointAuth:{method:'client_secret_basic'},scope:'commerce:payment:sync',resource:await managedCommerceOrigin()});
  const response=await fetch(tokenEndpoint,{method:'POST',headers:r.headers,body:r.body,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new ServiceError('payment_backend_oauth_unavailable',503);
  const data=await response.json() as {access_token?:string;token_type?:string;expires_in?:number};
  if(!data.access_token||data.token_type?.toLowerCase()!=='bearer'||!data.expires_in||data.expires_in>600)throw new ServiceError('invalid_machine_token',503);
  return data.access_token;
}
export async function rawDispatchCommerce(onlyPaymentId?:string){
  const lease=crypto.randomUUID();
  const {rows}=await pool.query(`WITH selected AS (SELECT id FROM commerce_delivery WHERE delivered_at IS NULL AND available_at<=now() AND (lease_until IS NULL OR lease_until<now()) AND ($1::uuid IS NULL OR payment_id=$1::uuid) ORDER BY available_at,id LIMIT 20 FOR UPDATE SKIP LOCKED) UPDATE commerce_delivery d SET lease_token=$2::uuid,lease_until=now()+interval '60 seconds',attempts=attempts+1 FROM selected s WHERE s.id=d.id RETURNING d.*`,[onlyPaymentId??null,lease]);
  let delivered=0,failed=0;
  for(const row of rows){try{
    const token=await machineToken();
    const path=row.kind==='capture'?'payment':row.kind==='failed'?'payment-failed':'payment-refund';
    const response=await fetch(new URL('/commerce/order/'+row.order_id+'/'+path,await managedCommerceOrigin()),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({externalId:row.payment_id,eventId:row.id,amountMinor:Number(row.amount_minor),currency:row.currency}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new ServiceError('commerce_delivery_rejected',503);
    const result=await response.json() as {data?:{refundRequired?:boolean}};
    if(row.kind==='refund'&&row.return_id){
      const returned=await fetch(new URL('/commerce/return/'+row.return_id+'/refund',await managedCommerceOrigin()),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({externalId:row.refund_id,amountMinor:Number(row.refund_minor),currency:row.currency}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
      if(!returned.ok)throw new ServiceError('return_refund_delivery_failed',503);
    }
    if(result.data?.refundRequired){
      const {rawRefundExpiredCommercePayment: refundExpiredCommercePayment}=await import('@/models/payments');
      await refundExpiredCommercePayment(row.payment_id);
    }
    await pool.query('UPDATE commerce_delivery SET delivered_at=now(),lease_until=NULL WHERE id=$1 AND lease_token=$2::uuid',[row.id,lease]);delivered++;
  }catch{
    await pool.query("UPDATE commerce_delivery SET lease_until=NULL,available_at=now()+least(3600,power(2,least(attempts,12))) * interval '1 second' WHERE id=$1 AND lease_token=$2::uuid",[row.id,lease]);failed++;
  }}
  return {delivered,failed};
}
