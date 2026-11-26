import { QueueClient } from "@vercel/queue"
const queue = new QueueClient({ telemetry: { isEnabled: false } })
export async function enqueueBackgroundJob(kind: "drain" | "maintenance" = "drain") {
  await queue.send("payment-jobs", { kind })
}
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
export async function processBackgroundJob(message: unknown) {
  const kind = message && typeof message === "object" ? (message as { kind?: unknown }).kind : undefined
  if (kind === "maintenance") {
    const { rawReconcilePayments: reconcilePayments, rawReconcileRefunds: reconcileRefunds } = await import("@/services/reconciliation")
    await reconcilePayments()
    await reconcileRefunds()
    await drainBackgroundJobs()
    return
  }
  if (kind !== "drain") throw new Error("Invalid background job")
  await drainBackgroundJobs()
}
