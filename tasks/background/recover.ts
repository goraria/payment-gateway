import { defineTask } from "nitro/task"
import { cronSecret, vercelDeployment } from "@/utils/environment"
import { enqueueBackgroundJob } from "@/services/background"
export default defineTask({
  meta: { description: "Recover durable outbox delivery" },
  async run() {
    if (vercelDeployment && !cronSecret) throw new Error("Background scheduler is not configured")
    await enqueueBackgroundJob("drain")
    return { result: { queued: true } }
  },
})
