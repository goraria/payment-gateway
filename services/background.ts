import { createBackgroundQueue } from "@/modules/principle/queue";

export const {
  enqueueBackgroundJob,
  processBackgroundJob,
  plugin: backgroundQueuePlugin,
} = createBackgroundQueue("payment-jobs", {
  drain: drainBackgroundJobs,
  maintenance: runMaintenance,
});

async function drainBackgroundJobs() {
  const { rawDispatchCommerce: dispatchCommerce } = await import("@/models/commerce-delivery")
  for (let batch = 0; batch < 10; batch++) {
    const result = await dispatchCommerce()
    if (("failed" in result && result.failed) || ("status" in result && result.status === "retry_or_failed"))
      throw new Error("Background delivery deferred")
    if (result.delivered < 20) return
  }
  await enqueueBackgroundJob()
}

async function runMaintenance() {
  const { rawReconcilePayments: reconcilePayments, rawReconcileRefunds: reconcileRefunds } = await import("@/services/reconciliation")
  await reconcilePayments()
  await reconcileRefunds()
  await drainBackgroundJobs()
}
