import type { ApiContext } from "@/types/auth";
import { getQueryValues, readRequestBody } from "@/utils/request";
import type Stripe from "stripe";
import { ServiceError } from "@/lib/errors";
import { uuidSchema } from "@/schemas/common";
import {
  createPaymentSchema,
  listPaymentSchema,
  refundPaymentSchema,
} from "@/schemas/payment";
import {
  rawCancelPayment as cancelPaymentServices,
  rawCreatePayment as createPaymentServices,
  rawGetPayment as getPaymentServices,
  rawListPayments as listPaymentsServices,
  rawProcessProviderEvent,
  rawQueryPayment as queryPaymentServices,
  rawRefundPayment as refundPaymentServices,
} from "@/models/payments";
import {
  verifyMomoWebhook,
  verifyStripeWebhook,
  verifyVnPayParameters,
  verifyZaloPayWebhook,
} from "@/services/provider";

function clientIp(context: ApiContext) {
  return (
    context.req.header("cf-connecting-ip") ??
    context.req.header("x-vercel-forwarded-for")?.split(",")[0]?.trim() ??
    context.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    context.req.header("x-real-ip") ??
    "127.0.0.1"
  );
}
export async function actListPayments(context: ApiContext) {
  return context.json(
    await listPaymentsServices(
      listPaymentSchema.parse(getQueryValues(context.req.raw)),
      context.get("auth")!,
    ),
    { headers: { "content-type": "application/json; charset=UTF-8" } },
  );
}
export async function actGetPayment(context: ApiContext) {
  return context.json(
    await getPaymentServices(
      uuidSchema.parse(context.req.param("id")!),
      context.get("auth")!,
    ),
    { headers: { "content-type": "application/json; charset=UTF-8" } },
  );
}
export async function actCreatePayment(context: ApiContext) {
  const idempotencyKey = context.req.header("idempotency-key")?.trim() ?? "";
  const result = await createPaymentServices(
    createPaymentSchema.parse(await readRequestBody(context.req)),
    idempotencyKey,
    clientIp(context),
    context.get("auth")!,
  );
  return context.json(result, {
    status: result.reused ? 200 : 201,
    headers: { "content-type": "application/json; charset=UTF-8" },
  });
}
export async function actQueryPayment(context: ApiContext) {
  return context.json(
    await queryPaymentServices(
      uuidSchema.parse(context.req.param("id")!),
      context.get("auth")!,
    ),
    { headers: { "content-type": "application/json; charset=UTF-8" } },
  );
}
export async function actCancelPayment(context: ApiContext) {
  return context.json(
    await cancelPaymentServices(
      uuidSchema.parse(context.req.param("id")!),
      context.get("auth")!,
    ),
    { headers: { "content-type": "application/json; charset=UTF-8" } },
  );
}
export async function actRefundPayment(context: ApiContext) {
  return context.json(
    await refundPaymentServices(
      uuidSchema.parse(context.req.param("id")!),
      refundPaymentSchema.parse(await readRequestBody(context.req)),
      context.get("auth")!,
      context.req.header("idempotency-key")?.trim() ?? "",
    ),
    {
      status: 201,
      headers: { "content-type": "application/json; charset=UTF-8" },
    },
  );
}
function stripePaymentIntent(event: Stripe.Event) {
  return event.data.object as Stripe.PaymentIntent;
}
export async function actStripeWebhook(context: ApiContext) {
  const signature = context.req.header("stripe-signature");
  if (!signature) throw new ServiceError("missing_stripe_signature", 400);
  let event: Stripe.Event;
  try {
    event = verifyStripeWebhook(await context.req.text(), signature);
  } catch {
    throw new ServiceError("invalid_stripe_signature", 400);
  }
  const supported = new Set([
    "payment_intent.amount_capturable_updated",
    "payment_intent.canceled",
    "payment_intent.payment_failed",
    "payment_intent.processing",
    "payment_intent.succeeded",
  ]);
  if (!supported.has(event.type))
    return context.json(
      { received: true, ignored: true },
      { headers: { "content-type": "application/json; charset=UTF-8" } },
    );
  const intent = stripePaymentIntent(event);
  const status =
    event.type === "payment_intent.succeeded"
      ? "succeeded"
      : event.type === "payment_intent.processing"
        ? "processing"
        : event.type === "payment_intent.amount_capturable_updated"
          ? "authorized"
          : event.type === "payment_intent.canceled"
            ? "cancelled"
            : "failed";
  await rawProcessProviderEvent({
    provider: "stripe",
    providerEventId: event.id,
    eventType: event.type,
    providerPaymentId: intent.id,
    providerTransactionId: intent.latest_charge
      ? String(intent.latest_charge)
      : undefined,
    status,
    amount: intent.amount,
    currency: intent.currency.toUpperCase(),
    payload: JSON.parse(JSON.stringify(event)) as Record<string, unknown>,
  });
  return context.json(
    { received: true },
    { headers: { "content-type": "application/json; charset=UTF-8" } },
  );
}
export async function actMomoWebhook(context: ApiContext) {
  const payload = (await readRequestBody(context.req)) as Record<string, unknown>;
  if (!verifyMomoWebhook(payload))
    throw new ServiceError("invalid_momo_signature", 400);
  const resultCode = Number(payload.resultCode);
  await rawProcessProviderEvent({
    provider: "momo",
    providerEventId: `${String(payload.orderId)}:${String(payload.transId ?? payload.responseTime)}`,
    eventType: "momo.payment",
    providerPaymentId: String(payload.orderId),
    providerTransactionId: payload.transId
      ? String(payload.transId)
      : undefined,
    status:
      resultCode === 0
        ? "succeeded"
        : resultCode === 9000
          ? "authorized"
          : resultCode === 1000
            ? "processing"
            : "failed",
    amount: Number(payload.amount),
    currency: "VND",
    payload,
  });
  return context.json(
    {
      partnerCode: payload.partnerCode,
      orderId: payload.orderId,
      requestId: payload.requestId,
      resultCode: 0,
      message: "success",
    },
    { headers: { "content-type": "application/json; charset=UTF-8" } },
  );
}
export async function actZaloPayWebhook(context: ApiContext) {
  const payload = (await readRequestBody(context.req)) as {
    data?: string;
    mac?: string;
    type?: number;
  };
  if (
    !payload.data ||
    !payload.mac ||
    !verifyZaloPayWebhook(payload.data, payload.mac)
  ) {
    return context.json(
      { return_code: -1, return_message: "invalid_signature" },
      { headers: { "content-type": "application/json; charset=UTF-8" } },
    );
  }
  const data = JSON.parse(payload.data) as Record<string, unknown>;
  await rawProcessProviderEvent({
    provider: "zalopay",
    providerEventId: String(
      data.zp_trans_id ?? `${data.app_trans_id}:${data.server_time}`,
    ),
    eventType: "zalopay.payment",
    providerPaymentId: String(data.app_trans_id),
    providerTransactionId: data.zp_trans_id
      ? String(data.zp_trans_id)
      : undefined,
    status: "succeeded",
    amount: Number(data.amount),
    currency: "VND",
    payload: data,
  });
  return context.json(
    { return_code: 1, return_message: "success" },
    { headers: { "content-type": "application/json; charset=UTF-8" } },
  );
}
export async function actVnPayWebhook(context: ApiContext) {
  const parameters = getQueryValues(context.req.raw);
  if (!verifyVnPayParameters(parameters)) {
    return context.json(
      { RspCode: "97", Message: "Invalid signature" },
      { headers: { "content-type": "application/json; charset=UTF-8" } },
    );
  }
  try {
    await rawProcessProviderEvent({
      provider: "vnpay",
      providerEventId: `${parameters.vnp_TxnRef}:${parameters.vnp_TransactionNo ?? parameters.vnp_PayDate}`,
      eventType: "vnpay.payment",
      providerPaymentId: parameters.vnp_TxnRef ?? "",
      providerTransactionId: parameters.vnp_TransactionNo,
      status:
        parameters.vnp_ResponseCode === "00" &&
        parameters.vnp_TransactionStatus === "00"
          ? "succeeded"
          : "failed",
      amount: Number(parameters.vnp_Amount) / 100,
      currency: parameters.vnp_CurrCode ?? "VND",
      payload: parameters,
    });
    return context.json(
      { RspCode: "00", Message: "Confirm Success" },
      { headers: { "content-type": "application/json; charset=UTF-8" } },
    );
  } catch (error) {
    if (
      error instanceof ServiceError &&
      error.message === "payment_not_found"
    ) {
      return context.json(
        { RspCode: "01", Message: "Order not found" },
        { headers: { "content-type": "application/json; charset=UTF-8" } },
      );
    }
    if (
      error instanceof ServiceError &&
      error.message === "provider_amount_mismatch"
    ) {
      return context.json(
        { RspCode: "04", Message: "Invalid amount" },
        { headers: { "content-type": "application/json; charset=UTF-8" } },
      );
    }
    throw error;
  }
}
export async function actPaymentReturn(context: ApiContext) {
  const provider = context.req.param("provider")!;
  if (provider !== "vnpay") {
    return context.json(
      {
        provider,
        status: "pending",
        message: "Check payment status through the API",
      },
      { headers: { "content-type": "application/json; charset=UTF-8" } },
    );
  }
  const parameters = getQueryValues(context.req.raw);
  if (!verifyVnPayParameters(parameters))
    throw new ServiceError("invalid_vnpay_signature", 400);
  return context.json(
    {
      provider,
      reference: parameters.vnp_TxnRef,
      succeeded:
        parameters.vnp_ResponseCode === "00" &&
        parameters.vnp_TransactionStatus === "00",
    },
    { headers: { "content-type": "application/json; charset=UTF-8" } },
  );
}
