import { createScheduledQueueTask } from "@/modules/principle/queue-task";
import { cronSecret, vercelDeployment } from "@/utils/environment";
import { enqueueBackgroundJob } from "@/services/background";

export default createScheduledQueueTask(
  "Enqueue scheduled maintenance",
  !vercelDeployment || Boolean(cronSecret),
  () => enqueueBackgroundJob("maintenance"),
);
