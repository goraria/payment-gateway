import { QueueClient } from "@vercel/queue";
import { definePlugin } from "nitro";

type JobKind = "drain" | "maintenance";
type Task = () => Promise<void>;

export function createBackgroundQueue(
  topic: string,
  tasks: { drain: Task; maintenance?: Task },
) {
  const queue = new QueueClient({ telemetry: { isEnabled: false } });

  async function enqueueBackgroundJob(kind: JobKind = "drain") {
    await queue.send(topic, { kind });
  }

  async function processBackgroundJob(message: unknown) {
    const kind =
      message && typeof message === "object" && "kind" in message
        ? message.kind
        : undefined;
    const task =
      kind === "drain" || kind === "maintenance" ? tasks[kind] : undefined;
    if (!task) throw new Error("Invalid background job");
    await task();
  }

  const plugin = definePlugin((nitro) => {
    nitro.hooks.hook("vercel:queue", async ({ message, metadata }) => {
      if (metadata.topicName !== topic)
        throw new Error("Unexpected queue topic");
      await processBackgroundJob(message);
    });
  });

  return { enqueueBackgroundJob, processBackgroundJob, plugin };
}
