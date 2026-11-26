import { getServiceOrigin } from "@/utils/sso-directory";
import { z } from 'zod';
import { isProduction } from '@/utils/environment';
import { ServiceError } from '@/lib/errors';
import type { RawCreatePaymentInput,CreatePaymentInput } from '@/schemas/payment';
import type { AuthContext } from '@/types/auth';
export async function managedCommerceOrigin(){
  const commerceUrl = await getServiceOrigin("commerce");
  if(!commerceUrl) throw new ServiceError('commerce_not_configured',503);
  const u=new URL(commerceUrl);
  if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||(u.protocol!=='https:'&&(isProduction||u.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)))) throw new ServiceError('invalid_commerce_configuration',503);
  return u.origin;
}
export const isCommerceOrder=(p:{application:string;referenceType:string})=>['marketplace','restaurant'].includes(p.application)&&p.referenceType==='order';
export async function authoritativeRefund(paymentId:string,returnId:string,auth:AuthContext){
  if(!auth.accessToken)throw new ServiceError('delegated_token_required',401);
  const url=new URL('/commerce/payment/'+z.uuid().parse(paymentId)+'/return/'+z.uuid().parse(returnId)+'/refund-quote',await managedCommerceOrigin());
  let r:Response;try{r=await fetch(url,{headers:{Authorization:'Bearer '+auth.accessToken},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});}catch{throw new ServiceError('commerce_unavailable',503);}
  if(!r.ok)throw new ServiceError('refund_forbidden',r.status===404?404:r.status===403?403:409);
  const {data:q}=z.object({data:z.object({returnId:z.uuid(),paymentId:z.uuid(),subject:z.string(),amountMinor:z.number().int().positive().safe(),currency:z.string().regex(/^[A-Z]{3}$/)})}).parse(await r.json());
  if(q.returnId!==returnId||q.paymentId!==paymentId||q.subject!==auth.user.externalUserId)throw new ServiceError('refund_forbidden',403);
  return q;
}
export async function authoritativePaymentInput(raw:RawCreatePaymentInput,auth:AuthContext):Promise<CreatePaymentInput>{
  if(!isCommerceOrder(raw)){
    if(!raw.amount||!raw.currency) throw new ServiceError('payment_amount_required',422);
    return {...raw,amount:raw.amount,currency:raw.currency};
  }
  if(!auth.accessToken) throw new ServiceError('delegated_token_required',401);
  const id=z.uuid().parse(raw.referenceId);
  let response:Response;
  try{response=await fetch(new URL('/commerce/order/'+id+'/payment-quote',await managedCommerceOrigin()),{headers:{Authorization:'Bearer '+auth.accessToken},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});}catch(e){if(e instanceof ServiceError)throw e;throw new ServiceError('commerce_unavailable',503);}
  if(!response.ok)throw new ServiceError('order_payment_forbidden',response.status===404?404:response.status===403?403:503);
  const {data:q}=z.object({data:z.object({orderId:z.uuid(),subject:z.string(),amountMinor:z.number().int().positive().safe(),currency:z.string().regex(/^[A-Z]{3}$/),payable:z.boolean()})}).parse(await response.json());
  if(q.orderId!==id||q.subject!==auth.user.externalUserId)throw new ServiceError('order_payment_forbidden',403);
  if((raw.amount!==undefined&&raw.amount!==q.amountMinor)||(raw.currency!==undefined&&raw.currency!==q.currency))throw new ServiceError('order_amount_mismatch',422);
  return {...raw,amount:q.amountMinor,currency:q.currency,description:'Commerce order '+id,metadata:{commerceOrder:true,payable:q.payable}};
}
