import type { ApiContext } from "@/types/auth";

export function actHealth(context: ApiContext) {
  return context.json(
    { status: "OK", service: "payment-gateway" },
    { headers: { "content-type": "application/json; charset=UTF-8" } },
  );
}
