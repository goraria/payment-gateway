import { createBackgroundMiddleware } from "@/modules/principle/background";
import { enqueueBackgroundJob } from "@/services/background";

export default createBackgroundMiddleware(enqueueBackgroundJob);
