import Stripe from "stripe";
import { H3, onError } from "nitro/h3";
import { expect, it, vi } from "vitest";

vi.mock("@/utils/environment", async (original) => ({
  ...(await original<typeof import("@/utils/environment")>()),
  stripeSecretKey: "test-key",
  stripeWebhookSecret: "test-webhook-secret",
}));

import handler from "@/app/server";
import { handleServiceError } from "@/middlewares/01.errors";

it("verifies the unmodified Stripe payload through the Nitro and Hono boundary", async () => {
  const app = new H3({ silent: true });
  app.use(onError(handleServiceError));
  app.post("/payment/webhook/stripe", handler);

  const payload = '{\n  "id": "evt_fixture", "type": "charge.updated"\n}';
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: "test-webhook-secret",
  });
  const send = (body: string) =>
    app.request("/payment/webhook/stripe", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": signature,
      },
      body,
    });

  const valid = await send(payload);
  expect(valid.status).toBe(200);
  expect(await valid.json()).toEqual({ received: true, ignored: true });
  expect((await send(JSON.stringify(JSON.parse(payload)))).status).toBe(400);
});

it("preserves form input and malformed JSON handling at the payment callback", async () => {
  const app = new H3({ silent: true });
  app.use(onError(handleServiceError));
  app.post("/payment/webhook/zalopay", handler);

  const form = await app.request("/payment/webhook/zalopay", {
    method: "POST",
    body: new URLSearchParams({ type: "1" }),
  });
  expect(form.status).toBe(200);
  expect(await form.json()).toEqual({
    return_code: -1,
    return_message: "invalid_signature",
  });

  const malformed = await app.request("/payment/webhook/zalopay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  expect(malformed.status).toBe(400);
  expect(await malformed.text()).toBe("Invalid JSON body");
});
