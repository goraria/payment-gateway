import { createServiceRouteFallback } from "@/modules/principle/service-errors";

const fallback = createServiceRouteFallback("Not Found");
export const routeNotFound = fallback.routeNotFound;
export default fallback.handler;
