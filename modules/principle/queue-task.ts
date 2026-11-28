import { defineTask } from "nitro/task";

export function createScheduledQueueTask(
  description: string,
  isConfigured: boolean,
  enqueue: () => Promise<unknown>,
) {
  return defineTask({
    meta: { description },
    async run() {
      if (!isConfigured) throw new Error("Background scheduler is not configured");
      await enqueue();
      return { result: { queued: true } };
    },
  });
}
