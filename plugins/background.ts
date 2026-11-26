import { definePlugin } from "nitro"
import { processBackgroundJob } from "@/services/background"
export default definePlugin((nitro) => {
  nitro.hooks.hook("vercel:queue", async ({ message, metadata }) => {
    if (metadata.topicName !== "payment-jobs") throw new Error("Unexpected queue topic")
    await processBackgroundJob(message)
  })
})
