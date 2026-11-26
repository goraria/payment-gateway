import { defineTask } from "nitro/task"
import { cronSecret, vercelDeployment } from "@/utils/environment"
import { enqueueBackgroundJob } from "@/services/background"
export default defineTask({
  meta: { description: "Enqueue scheduled maintenance" },
  async run() {
    if (vercelDeployment && !cronSecret) throw new Error("Background scheduler is not configured")
    await enqueueBackgroundJob("maintenance")
    return { result: { queued: true } }
  },
})
