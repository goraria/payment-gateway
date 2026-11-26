vi.mock("@/utils/sso-directory", () => ({
  getServiceOrigin: async (key: string) => {
    const origins: Record<string, string> = {"commerce":"https://commerce.fixture.test"};
    if (!origins[key]) throw new Error("Unregistered fixture service");
    return origins[key];
  },
  getApplicationOrigin: async (key: string) => {
    const origins: Record<string, string> = {"commerce":"https://commerce.fixture.test"};
    if (!origins[key]) throw new Error("Unregistered fixture application");
    return origins[key];
  },
}));
import {beforeAll,beforeEach,afterAll,it,expect,vi} from 'vitest';
import {sql} from 'drizzle-orm';
const state=vi.hoisted(()=>({provider:vi.fn(),refund:vi.fn(),remote:vi.fn(),outage:false,lateRefund:false}));
vi.mock('@/utils/environment',async original=>({...await original<object>(),authUrl:'https://sso.fixture.test',commerceUrl:'https://commerce.fixture.test',oauthClientId:'payment-confidential',oauthClientSecret:'fixture-secret',isProduction:true}));
vi.mock('@/services/provider',()=>({createProviderPayment:state.provider,resumeProviderCheckout:vi.fn(),refundProviderPayment:state.refund,refundRequestReference:(_p:string,id:string)=>'refund-'+id,queryProviderPayment:vi.fn(),cancelProviderPayment:vi.fn()}));
import {database,pool} from '@/database';
import {rawCreatePayment,rawProcessProviderEvent,rawRefundPayment} from '@/models/payments';
import {rawDispatchCommerce} from '@/models/commerce-delivery';
import type {AuthContext} from '@/types/auth';
const uid=crypto.randomUUID(),oid=crypto.randomUUID(),sub='payment-cloud-'+uid;
const auth={application:'marketplace',clientId:'gorth-online-marketplace-solution',sessionId:null,accessToken:'fixture-user-grant',scopes:['marketplace:write'],user:{id:uid,externalUserId:sub,role:'user'}} as AuthContext;
const input={application:'marketplace',referenceType:'order',referenceId:oid,provider:'stripe' as const};
let paymentId:string;
const providerId='pi_fixture_'+crypto.randomUUID();
beforeAll(async()=>{await database.execute(sql`INSERT INTO users(id,external_user_id,email,name) VALUES(${uid}::uuid,${sub},${uid+'@example.invalid'},'Payment fixture')`);});
beforeEach(()=>{
 vi.stubGlobal('fetch',state.remote);state.provider.mockResolvedValue({providerPaymentId:providerId,status:'requires_action',checkoutUrl:'https://checkout.fixture.test',raw:{}});
 state.refund.mockImplementation(async()=>({id:'re_fixture_'+crypto.randomUUID(),status:'succeeded',raw:{}}));
 state.remote.mockImplementation(async(url:URL|string)=>{
  const path=String(url);
  if(path.endsWith('/auth/oauth2/token'))return Response.json({access_token:'fixture-machine-grant',token_type:'Bearer',expires_in:60});
  if(path.endsWith('/payment-quote'))return Response.json({data:{orderId:new URL(path).pathname.split('/')[3],subject:sub,amountMinor:50000,currency:'VND',payable:true}});
  if(path.endsWith('/refund-quote'))return Response.json({data:{paymentId:new URL(path).pathname.split('/')[3],returnId:new URL(path).pathname.split('/')[5],subject:sub,amountMinor:6000,currency:'VND'}});
  if(state.outage)return Response.json({error:'offline'},{status:503});
  return Response.json({data:{confirmed:true,refundRequired:state.lateRefund&&path.endsWith('/payment')}});
 });
});
afterAll(async()=>{
 await pool.query('DELETE FROM commerce_delivery WHERE payment_id IN(SELECT id FROM payments WHERE user_id=$1)',[uid]);
 await pool.query('DELETE FROM webhook_events WHERE provider_event_id LIKE $1',[uid+':%']);
 await pool.query('DELETE FROM payment_history WHERE payment_id IN(SELECT id FROM payments WHERE user_id=$1)',[uid]);
 await pool.query('DELETE FROM payment_transactions WHERE payment_id IN(SELECT id FROM payments WHERE user_id=$1)',[uid]);
 await pool.query('DELETE FROM refunds WHERE payment_id IN(SELECT id FROM payments WHERE user_id=$1)',[uid]);
 await pool.query('DELETE FROM payments WHERE user_id=$1',[uid]);await pool.query('DELETE FROM users WHERE id=$1',[uid]);await pool.end();vi.unstubAllGlobals();
});
it('rejects tampered browser amount before creating a provider payment',async()=>{await expect(rawCreatePayment({...input,amount:1,currency:'VND'},'tamper','127.0.0.1',auth)).rejects.toMatchObject({status:422});expect(state.provider).not.toHaveBeenCalled();});
it('creates one server-priced payment and reuses it despite a changed browser retry key',async()=>{
 const a=await rawCreatePayment(input,'first-key','127.0.0.1',auth);paymentId=a.payment.id;
 const b=await rawCreatePayment(input,'second-key','127.0.0.1',auth);
 expect(b.payment.id).toBe(paymentId);expect(a.payment.amount).toBe(50000);expect(state.provider).toHaveBeenCalledTimes(1);
});
it('rejects a second provider against the same authoritative order',async()=>{await expect(rawCreatePayment({...input,provider:'momo'},'third-key','127.0.0.1',auth)).rejects.toMatchObject({status:409});});
const event=(suffix:string,status:'succeeded'|'failed')=>({provider:'stripe' as const,providerEventId:uid+':'+suffix,eventType:'fixture.'+status,providerPaymentId:providerId,status,amount:50000,currency:'VND',payload:{}});
it('commits capture plus durable delivery atomically and ignores duplicate/out-of-order provider events',async()=>{
 await rawProcessProviderEvent(event('capture','succeeded'));expect(await rawProcessProviderEvent(event('capture','succeeded'))).toMatchObject({duplicate:true});
 await rawProcessProviderEvent(event('old-failure','failed'));
 const {rows}=await pool.query('SELECT status,amount_captured FROM payments WHERE id=$1',[paymentId]);expect(rows[0].status).toBe('succeeded');expect(Number(rows[0].amount_captured)).toBe(50000);
 const out=await pool.query("SELECT * FROM commerce_delivery WHERE payment_id=$1 AND kind='capture'",[paymentId]);expect(out.rows).toHaveLength(1);
});
it('keeps delivery retryable during Commerce outage and acknowledges only a successful retry',async()=>{
 state.outage=true;expect(await rawDispatchCommerce(paymentId)).toMatchObject({failed:1});
 let out=await pool.query('SELECT delivered_at,attempts FROM commerce_delivery WHERE payment_id=$1',[paymentId]);expect(out.rows[0].delivered_at).toBeNull();expect(out.rows[0].attempts).toBe(1);
 state.outage=false;await pool.query('UPDATE commerce_delivery SET available_at=now() WHERE payment_id=$1',[paymentId]);expect(await rawDispatchCommerce(paymentId)).toMatchObject({delivered:1});
 out=await pool.query('SELECT delivered_at FROM commerce_delivery WHERE payment_id=$1',[paymentId]);expect(out.rows[0].delivered_at).not.toBeNull();
});
it('persists refund outcome once and emits a monotonic cumulative refund delivery',async()=>{
 const admin={...auth,user:{...auth.user,role:'admin'}} as AuthContext;
 const first=await rawRefundPayment(paymentId,{amount:10000},admin,'fixture-refund');
 const again=await rawRefundPayment(paymentId,{amount:10000},admin,'fixture-refund');
 expect(again.id).toBe(first.id);
 const {rows}=await pool.query("SELECT amount_minor FROM commerce_delivery WHERE payment_id=$1 AND kind='refund'",[paymentId]);expect(rows).toHaveLength(1);expect(Number(rows[0].amount_minor)).toBe(10000);
 expect(await rawDispatchCommerce(paymentId)).toMatchObject({delivered:1});
});
it('refunds a Commerce-approved return without granting global admin and delivers both cumulative and return state',async()=>{
 const returnId=crypto.randomUUID();
 const first=await rawRefundPayment(paymentId,{commerceReturnId:returnId},auth,'merchant-first');
 const retry=await rawRefundPayment(paymentId,{commerceReturnId:returnId},auth,'merchant-second');
 expect(retry.id).toBe(first.id);expect(first.amount).toBe(6000);
 const result=await rawDispatchCommerce(paymentId);expect(result.delivered).toBe(1);
 expect(state.remote.mock.calls.some(([url])=>String(url).endsWith('/commerce/return/'+returnId+'/refund'))).toBe(true);
});
it('automatically refunds a late capture only after Commerce requests it',async()=>{
 const id=crypto.randomUUID(),providerPaymentId='pi_late_'+uid;
 state.provider.mockResolvedValue({providerPaymentId,status:'requires_action',raw:{}});
 const created=await rawCreatePayment({...input,referenceId:id},'late-key','127.0.0.1',auth);
 await rawProcessProviderEvent({...event('late-capture','succeeded'),providerPaymentId});
 state.lateRefund=true;expect(await rawDispatchCommerce(created.payment.id)).toMatchObject({delivered:1});
 const status=await pool.query('SELECT status,amount_refunded FROM payments WHERE id=$1',[created.payment.id]);
 expect(status.rows[0].status).toBe('refunded');expect(Number(status.rows[0].amount_refunded)).toBe(50000);
 state.lateRefund=false;expect(await rawDispatchCommerce(created.payment.id)).toMatchObject({delivered:1});
});
