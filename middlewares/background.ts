import { defineMiddleware } from "nitro/h3"
import { enqueueBackgroundJob } from "@/services/background"
export default defineMiddleware(async (event, next) => {
  const response = await next()
  // A Queue acknowledgement must never enqueue another job, including an empty drain.
  const pathname = new URL(event.req.url).pathname
  if (pathname.startsWith("/_vercel/") || pathname.startsWith("/_nitro/")) return response
  if (["POST", "PUT", "PATCH", "DELETE"].includes(event.req.method) &&
      response instanceof Response && response.ok) {
    const enqueue = enqueueBackgroundJob().catch(() => {
      console.error("[background] enqueue_failed; durable state retained for recovery")
    })
    if (event.req.waitUntil) event.req.waitUntil(enqueue)
    else await enqueue
  }
  return response
})
