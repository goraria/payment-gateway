import type { Event } from "@/utils/interface";
import { listProviderCapabilities as listProviderCapabilitiesServices } from "@/services/capabilities";
export function actListProviderCapabilities(context: Event) {
  return context.json(
    { data: listProviderCapabilitiesServices() },
    { headers: { "content-type": "application/json; charset=UTF-8" } },
  );
}
