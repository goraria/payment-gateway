import { pool } from "@/database";
import { queryProviderRefund, type ProviderCode } from "@/services/provider";
import { rawSettleRefund } from "@/models/payments";
import {rawReconcileProviderPayment} from '@/models/payments';
export async function rawReconcilePayments(){
 const {rows}=await pool.query("SELECT id FROM payments WHERE provider_payment_id IS NOT NULL AND status IN('pending','requires_action','authorized','processing','failed','cancelled') AND updated_at<now()-interval '1 minute' AND created_at>now()-interval '7 days' ORDER BY updated_at,id LIMIT 20");
 let checked=0,failed=0;for(const row of rows){try{await rawReconcileProviderPayment(row.id);checked++;}catch{failed++;}finally{await pool.query('UPDATE payments SET updated_at=now() WHERE id=$1',[row.id]);}}
 return {checked,failed};
}

export async function rawReconcileRefunds() {
  const { rows } =
    await pool.query(`SELECT r.id,r.provider_refund_id,p.provider FROM refunds r JOIN payments p ON p.id=r.payment_id
    WHERE r.status='processing' AND r.provider_refund_id IS NOT NULL AND r.updated_at<now()-interval '1 minute'
    ORDER BY r.updated_at,r.id LIMIT 20`);
  let settled = 0,
    pending = 0,
    failed = 0;
  for (const refund of rows) {
    try {
      const status = await queryProviderRefund(
        refund.provider as ProviderCode,
        refund.provider_refund_id,
      );
      await rawSettleRefund(refund.id, status);
      status === "processing" ? pending++ : settled++;
    } catch {
      failed++;
    }
  }
  return { settled, pending, failed };
}
