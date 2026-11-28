import { createScheduledQueueTask } from "@/modules/principle/queue-task";
import { cronSecret, vercelDeployment } from "@/utils/environment";
import { enqueueBackgroundJob } from "@/services/background";

export default createScheduledQueueTask(
  "Recover durable outbox delivery",
  !vercelDeployment || Boolean(cronSecret),
  () => enqueueBackgroundJob("drain"),
);
