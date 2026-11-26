vi.mock("@/utils/sso-directory", () => ({
  getServiceOrigin: async (key: string) => {
    const origins: Record<string, string> = {"commerce":"https://commerce.test"};
    if (!origins[key]) throw new Error("Unregistered fixture service");
    return origins[key];
  },
  getApplicationOrigin: async (key: string) => {
    const origins: Record<string, string> = {"commerce":"https://commerce.test"};
    if (!origins[key]) throw new Error("Unregistered fixture application");
    return origins[key];
  },
}));
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
vi.mock('@/utils/environment',()=>({commerceUrl:'https://commerce.test',isProduction:true}));
import {authoritativePaymentInput} from '@/services/commerce-order';
import type {AuthContext} from '@/types/auth';
const auth={application:'marketplace',accessToken:'private-grant',user:{id:'local',externalUserId:'buyer-subject'}} as AuthContext;
const input={application:'marketplace',referenceType:'order',referenceId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',provider:'stripe' as const};
const quote={orderId:input.referenceId,subject:'buyer-subject',amountMinor:50000,currency:'VND',payable:true};
const remote=vi.fn();
beforeEach(()=>{vi.stubGlobal('fetch',remote);remote.mockReset();remote.mockResolvedValue(Response.json({data:quote}));});
afterEach(()=>vi.unstubAllGlobals());
it('derives money and canonical order metadata from Commerce, not browser fields',async()=>{
 const p=await authoritativePaymentInput({...input,metadata:{commerceOrder:false,amount:1}},auth);
 expect(p).toMatchObject({amount:50000,currency:'VND',metadata:{commerceOrder:true,payable:true}});
 expect(remote.mock.calls[0]![0].href).toBe('https://commerce.test/commerce/order/'+input.referenceId+'/payment-quote');
 expect(remote.mock.calls[0]![1].headers).toEqual({Authorization:'Bearer private-grant'});
});
it.each([{amount:1},{currency:'USD'}])('rejects tampered monetary input %j',async extra=>{await expect(authoritativePaymentInput({...input,...extra},auth)).rejects.toMatchObject({status:422,message:'order_amount_mismatch'});});
it('rejects a different order owner even if an upstream DTO is inconsistent',async()=>{remote.mockResolvedValue(Response.json({data:{...quote,subject:'other'}}));await expect(authoritativePaymentInput(input,auth)).rejects.toMatchObject({status:403});});
it('requires the original delegated user credential',async()=>{await expect(authoritativePaymentInput(input,{...auth,accessToken:undefined})).rejects.toMatchObject({status:401});expect(remote).not.toHaveBeenCalled();});
it.each([403,404])('preserves an unauthorized order result %s',async status=>{remote.mockResolvedValue(Response.json({error:'denied'},{status}));await expect(authoritativePaymentInput(input,auth)).rejects.toMatchObject({status});});
it('fails closed on Commerce outage',async()=>{remote.mockRejectedValue(Error('outage'));await expect(authoritativePaymentInput(input,auth)).rejects.toMatchObject({status:503});});
it('keeps other applications on their existing amount contract',async()=>{expect(await authoritativePaymentInput({...input,application:'task',referenceType:'invoice',amount:100,currency:'USD'},auth)).toMatchObject({amount:100,currency:'USD'});expect(remote).not.toHaveBeenCalled();});
