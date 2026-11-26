import {it,expect} from 'vitest';
import Stripe from 'stripe';
import {stripeSecretKey} from '@/utils/environment';
import {createProviderPayment,queryProviderPayment,refundProviderPayment,cancelProviderPayment} from '@/services/provider';
it('runs test-mode Stripe create/retry, capture, refund/retry and declined-card cancellation',async()=>{
 if(!stripeSecretKey?.startsWith('sk_test_'))throw Error('stripe_test_credentials_required');
 const stripe=new Stripe(stripeSecretKey,{maxNetworkRetries:0,timeout:15000});
 const paymentId=crypto.randomUUID(),refundId=crypto.randomUUID(),remainderId=crypto.randomUUID();
 const created:string[]=[];let captured:string|undefined;
 try{
  const input={provider:'stripe' as const,paymentId,application:'marketplace',referenceType:'order',referenceId:crypto.randomUUID(),idempotencyKey:'gorth-sandbox:'+paymentId,amount:500,currency:'USD',clientIp:'127.0.0.1',description:'Gorth sandbox verification'};
  const a=await createProviderPayment(input);created.push(a.providerPaymentId);
  const retry=await createProviderPayment(input);expect(retry.providerPaymentId).toBe(a.providerPaymentId);
  const confirmed=await stripe.paymentIntents.confirm(a.providerPaymentId,{payment_method:'pm_card_visa',return_url:'https://example.invalid/return'});
  captured=a.providerPaymentId;expect(confirmed.status).toBe('succeeded');
  expect(await queryProviderPayment('stripe',a.providerPaymentId,{})).toMatchObject({status:'succeeded',amount:500});
  const partial=await refundProviderPayment('stripe',a.providerPaymentId,100,paymentId,{refundId,currency:'USD',full:false,createdAt:new Date(),metadata:{}});
  const again=await refundProviderPayment('stripe',a.providerPaymentId,100,paymentId,{refundId,currency:'USD',full:false,createdAt:new Date(),metadata:{}});
  expect(again.id).toBe(partial.id);
  await refundProviderPayment('stripe',a.providerPaymentId,400,paymentId,{refundId:remainderId,currency:'USD',full:false,createdAt:new Date(),metadata:{}});
  const refunds=await stripe.refunds.list({payment_intent:a.providerPaymentId,limit:10});expect(refunds.data.reduce((n,r)=>n+r.amount,0)).toBe(500);
  const failed=await createProviderPayment({...input,paymentId:crypto.randomUUID(),idempotencyKey:'gorth-sandbox-failed:'+paymentId});created.push(failed.providerPaymentId);
  let declined=false;try{await stripe.paymentIntents.confirm(failed.providerPaymentId,{payment_method:'pm_card_chargeDeclined',return_url:'https://example.invalid/return'});}catch(e){declined=(e as {code?:string}).code==='card_declined';}
  expect(declined).toBe(true);expect(await cancelProviderPayment('stripe',failed.providerPaymentId)).toMatchObject({status:'cancelled'});
 }catch(e){
  const code=(e as {code?:string}).code;
  // Provider exceptions can include an API key fragment. Never expose them.
  throw Error('stripe_sandbox_'+(typeof code==='string'&&/^[a-z0-9_]+$/.test(code)?code:'verification_failed'));
 }finally{
  for(const id of created){try{const p=await stripe.paymentIntents.retrieve(id);if(p.status==='succeeded'&&id===captured){const charge=typeof p.latest_charge==='string'?await stripe.charges.retrieve(p.latest_charge):p.latest_charge;if(charge&&!charge.refunded)await stripe.refunds.create({payment_intent:id},{idempotencyKey:'cleanup:'+paymentId});}else if(!['succeeded','canceled'].includes(p.status))await stripe.paymentIntents.cancel(id);}catch{/* Cleanup remains scoped to this run's test-mode intents. */}}
 }
});
