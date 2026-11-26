import type { ApiContext } from "@/types/auth";
import { listProviderCapabilities as listProviderCapabilitiesServices } from "@/services/capabilities";
export function actListProviderCapabilities(context: ApiContext) {
  return context.json(
    { data: listProviderCapabilitiesServices() },
    { headers: { "content-type": "application/json; charset=UTF-8" } },
  );
}
