import { getServiceOrigin } from "@/utils/sso-directory";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import Stripe from "stripe";

import { ServiceError } from "@/lib/errors";
import {
  momoAccessKey,
  momoApiUrl,
  momoPartnerCode,
  momoPartnerName,
  momoSecretKey,
  momoStoreId,
  stripePublishableKey,
  stripeSecretKey,
  stripeWebhookSecret,
  vnPayApiUrl,
  vnPayHashSecret,
  vnPayLocale,
  vnPayPaymentUrl,
  vnPayTmnCode,
  zaloPayApiUrl,
  zaloPayMerchantAppId,
  zaloPayMerchantKey1,
  zaloPayMerchantKey2,
} from "@/utils/environment";
import type { CreatePaymentInput } from "@/schemas/payment";

export type ProviderCode = CreatePaymentInput["provider"];
export type NormalizedProviderStatus =
  | "pending"
  | "requires_action"
  | "authorized"
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface ProviderPaymentResult {
  providerPaymentId: string;
  status: NormalizedProviderStatus;
  checkoutUrl?: string;
  clientSecret?: string;
  publishableKey?: string;
  raw: Record<string, unknown>;
}

export interface ProviderQueryResult {
  providerTransactionId?: string;
  status: NormalizedProviderStatus;
  amount?: number;
  raw: Record<string, unknown>;
}

interface CreateProviderPaymentInput extends CreatePaymentInput {
  paymentId: string;
  idempotencyKey: string;
  clientIp: string;
}

function required(value: string | undefined, name: string) {
  if (!value) throw new ServiceError(`missing_${name.toLowerCase()}`, 502);
  return value;
}

function hmac(algorithm: "sha256" | "sha512", key: string, value: string) {
  return createHmac(algorithm, key).update(value, "utf8").digest("hex");
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

async function fetchJson(url: string, init: RequestInit) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password)
    throw new ServiceError("invalid_provider_url", 502);
  const response = await fetch(endpoint, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw new ServiceError("provider_request_failed", 502);
  }
  return payload;
}

let stripeClient: Stripe | undefined;
function stripe() {
  stripeClient ??= new Stripe(required(stripeSecretKey, "stripe_secret_key"), {
    maxNetworkRetries: 2,
    timeout: 30_000,
  });
  return stripeClient;
}

function mapStripeStatus(
  status: Stripe.PaymentIntent.Status,
): NormalizedProviderStatus {
  if (status === "succeeded") return "succeeded";
  if (status === "processing") return "processing";
  if (status === "requires_capture") return "authorized";
  if (status === "canceled") return "cancelled";
  return "requires_action";
}

async function createStripePayment(
  input: CreateProviderPaymentInput,
): Promise<ProviderPaymentResult> {
  const intent = await stripe().paymentIntents.create(
    {
      amount: input.amount,
      currency: input.currency.toLowerCase(),
      description: input.description,
      automatic_payment_methods: { enabled: true },
      metadata: {
        paymentId: input.paymentId,
        application: input.application,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
      },
    },
    { idempotencyKey: input.idempotencyKey },
  );

  return {
    providerPaymentId: intent.id,
    status: mapStripeStatus(intent.status),
    clientSecret: intent.client_secret ?? undefined,
    publishableKey: stripePublishableKey,
    raw: { id: intent.id, status: intent.status },
  };
}

async function createMomoPayment(
  input: CreateProviderPaymentInput,
): Promise<ProviderPaymentResult> {
  if (input.currency !== "VND")
    throw new ServiceError("momo_requires_vnd", 422);
  const partnerCode = required(momoPartnerCode, "momo_partner_code");
  const accessKey = required(momoAccessKey, "momo_access_key");
  const secretKey = required(momoSecretKey, "momo_secret_key");
  const requestId = randomUUID();
  const orderId = input.paymentId;
  const orderInfo = input.description ?? `Payment ${input.referenceId}`;
  const redirectUrl =
    input.returnUrl ?? new URL("/payment/return/momo", await getServiceOrigin("payment")).href;
  const ipnUrl = new URL("/payment/webhook/momo", await getServiceOrigin("payment")).href;
  const extraData = Buffer.from(
    JSON.stringify({
      paymentId: input.paymentId,
      application: input.application,
    }),
  ).toString("base64");
  const requestType = "payWithMethod";
  const rawSignature = [
    `accessKey=${accessKey}`,
    `amount=${input.amount}`,
    `extraData=${extraData}`,
    `ipnUrl=${ipnUrl}`,
    `orderId=${orderId}`,
    `orderInfo=${orderInfo}`,
    `partnerCode=${partnerCode}`,
    `redirectUrl=${redirectUrl}`,
    `requestId=${requestId}`,
    `requestType=${requestType}`,
  ].join("&");

  const payload = await fetchJson(
    `${required(momoApiUrl, "momo_api_url").replace(/\/+$/, "")}/v2/gateway/api/create`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        partnerCode,
        partnerName: momoPartnerName ?? "Gorth",
        storeId: momoStoreId ?? "Gorth",
        requestId,
        amount: input.amount,
        orderId,
        orderInfo,
        redirectUrl,
        ipnUrl,
        lang: "vi",
        requestType,
        autoCapture: true,
        extraData,
        signature: hmac("sha256", secretKey, rawSignature),
      }),
    },
  );
  const resultCode = Number(payload.resultCode);
  if (resultCode !== 0)
    throw new ServiceError(`momo_${resultCode || "create_failed"}`, 502);
  return {
    providerPaymentId: orderId,
    status: "requires_action",
    checkoutUrl: String(payload.payUrl ?? payload.shortLink ?? ""),
    raw: payload,
  };
}

function zaloDatePrefix() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value.year}${value.month}${value.day}`;
}

async function createZaloPayPayment(
  input: CreateProviderPaymentInput,
): Promise<ProviderPaymentResult> {
  if (input.currency !== "VND")
    throw new ServiceError("zalopay_requires_vnd", 422);
  const appId = Number(required(zaloPayMerchantAppId, "zalopay_app_id"));
  const key1 = required(zaloPayMerchantKey1, "zalopay_key1");
  const appTransId = `${zaloDatePrefix()}_${input.paymentId.replaceAll("-", "").slice(0, 24)}`;
  const appTime = Date.now();
  const appUser = input.application;
  const item = JSON.stringify([
    { id: input.referenceId, amount: input.amount, quantity: 1 },
  ]);
  const embedData = JSON.stringify({
    redirecturl:
      input.returnUrl ?? new URL("/payment/return/zalopay", await getServiceOrigin("payment")).href,
    paymentId: input.paymentId,
  });
  const macInput = `${appId}|${appTransId}|${appUser}|${input.amount}|${appTime}|${embedData}|${item}`;
  const body = new URLSearchParams({
    app_id: String(appId),
    app_user: appUser,
    app_time: String(appTime),
    amount: String(input.amount),
    app_trans_id: appTransId,
    embed_data: embedData,
    item,
    description: input.description ?? `Payment ${input.referenceId}`,
    bank_code: "zalopayapp",
    callback_url: new URL("/payment/webhook/zalopay", await getServiceOrigin("payment")).href,
    mac: hmac("sha256", key1, macInput),
  });
  const payload = await fetchJson(
    `${required(zaloPayApiUrl, "zalopay_api_url").replace(/\/+$/, "")}/v2/create`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    },
  );
  if (Number(payload.return_code) !== 1) {
    throw new ServiceError(
      `zalopay_${String(payload.sub_return_code ?? "create_failed")}`,
      502,
    );
  }
  return {
    providerPaymentId: appTransId,
    status: "requires_action",
    checkoutUrl: String(payload.order_url ?? ""),
    raw: payload,
  };
}

function vnPayDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value.year}${value.month}${value.day}${value.hour}${value.minute}${value.second}`;
}

function encodeVnPay(value: string) {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(
      /[!'()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
}

function serializeVnPay(parameters: Record<string, string>) {
  return Object.entries(parameters)
    .filter(([, value]) => value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeVnPay(key)}=${encodeVnPay(value)}`)
    .join("&");
}

async function createVnPayPayment(
  input: CreateProviderPaymentInput,
): Promise<ProviderPaymentResult> {
  if (input.currency !== "VND")
    throw new ServiceError("vnpay_requires_vnd", 422);
  const createdAt = new Date();
  const providerPaymentId = input.paymentId.replaceAll("-", "");
  const parameters: Record<string, string> = {
    vnp_Version: "2.1.0",
    vnp_Command: "pay",
    vnp_TmnCode: required(vnPayTmnCode, "vnpay_tmn_code"),
    vnp_Amount: String(input.amount * 100),
    vnp_CurrCode: "VND",
    vnp_TxnRef: providerPaymentId,
    vnp_OrderInfo: input.description ?? `Payment ${input.referenceId}`,
    vnp_OrderType: "other",
    vnp_Locale: vnPayLocale,
    vnp_ReturnUrl:
      input.returnUrl ?? new URL("/payment/return/vnpay", await getServiceOrigin("payment")).href,
    vnp_IpAddr: input.clientIp,
    vnp_CreateDate: vnPayDate(createdAt),
    vnp_ExpireDate: vnPayDate(new Date(createdAt.getTime() + 15 * 60_000)),
  };
  const query = serializeVnPay(parameters);
  const signature = hmac(
    "sha512",
    required(vnPayHashSecret, "vnpay_hash_secret"),
    query,
  );
  return {
    providerPaymentId,
    status: "requires_action",
    checkoutUrl: `${required(vnPayPaymentUrl, "vnpay_payment_url")}?${query}&vnp_SecureHash=${signature}`,
    raw: { ...parameters },
  };
}

export async function createProviderPayment(input: CreateProviderPaymentInput) {
  if (input.provider === "stripe") return createStripePayment(input);
  if (input.provider === "momo") return createMomoPayment(input);
  if (input.provider === "zalopay") return createZaloPayPayment(input);
  return createVnPayPayment(input);
}

/** Owner-checked callers may resume a checkout without creating a new charge. */
export async function resumeProviderCheckout(
  provider: ProviderCode,
  providerPaymentId: string | null,
  metadata: Record<string, unknown>,
) {
  if (provider === "stripe" && providerPaymentId) {
    const intent = await stripe().paymentIntents.retrieve(providerPaymentId);
    if (
      ![
        "requires_payment_method",
        "requires_action",
        "requires_confirmation",
      ].includes(intent.status)
    )
      return undefined;
    return {
      clientSecret: intent.client_secret ?? undefined,
      publishableKey: stripePublishableKey,
    };
  }
  const url = metadata.checkoutUrl;
  if (typeof url !== "string") return undefined;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    throw new ServiceError("invalid_provider_url", 502);
  return { url };
}

export async function queryProviderPayment(
  provider: ProviderCode,
  providerPaymentId: string,
  metadata: Record<string, unknown>,
): Promise<ProviderQueryResult> {
  if (provider === "stripe") {
    const intent = await stripe().paymentIntents.retrieve(providerPaymentId);
    return {
      providerTransactionId: intent.latest_charge
        ? String(intent.latest_charge)
        : undefined,
      status: mapStripeStatus(intent.status),
      amount: intent.amount,
      raw: { id: intent.id, status: intent.status, amount: intent.amount },
    };
  }

  if (provider === "momo") {
    const partnerCode = required(momoPartnerCode, "momo_partner_code");
    const accessKey = required(momoAccessKey, "momo_access_key");
    const requestId = randomUUID();
    const raw = `accessKey=${accessKey}&orderId=${providerPaymentId}&partnerCode=${partnerCode}&requestId=${requestId}`;
    const payload = await fetchJson(
      `${required(momoApiUrl, "momo_api_url").replace(/\/+$/, "")}/v2/gateway/api/query`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partnerCode,
          requestId,
          orderId: providerPaymentId,
          lang: "vi",
          signature: hmac(
            "sha256",
            required(momoSecretKey, "momo_secret_key"),
            raw,
          ),
        }),
      },
    );
    const code = Number(payload.resultCode);
    return {
      providerTransactionId: payload.transId
        ? String(payload.transId)
        : undefined,
      status:
        code === 0
          ? "succeeded"
          : code === 9000
            ? "authorized"
            : code === 1000
              ? "processing"
              : "failed",
      amount: Number(payload.amount) || undefined,
      raw: payload,
    };
  }

  if (provider === "zalopay") {
    const appId = Number(required(zaloPayMerchantAppId, "zalopay_app_id"));
    const key1 = required(zaloPayMerchantKey1, "zalopay_key1");
    const body = new URLSearchParams({
      app_id: String(appId),
      app_trans_id: providerPaymentId,
      mac: hmac("sha256", key1, `${appId}|${providerPaymentId}|${key1}`),
    });
    const payload = await fetchJson(
      `${required(zaloPayApiUrl, "zalopay_api_url").replace(/\/+$/, "")}/v2/query`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
    );
    const code = Number(payload.return_code);
    return {
      providerTransactionId: payload.zp_trans_id
        ? String(payload.zp_trans_id)
        : undefined,
      status:
        code === 1
          ? "succeeded"
          : code === 3 || payload.is_processing === true
            ? "processing"
            : "failed",
      amount: Number(payload.amount) || undefined,
      raw: payload,
    };
  }

  const transactionDate =
    typeof metadata.vnpCreateDate === "string" ? metadata.vnpCreateDate : "";
  if (!transactionDate)
    throw new ServiceError("missing_vnpay_transaction_date", 422);
  const requestId = randomUUID().replaceAll("-", "").slice(0, 32);
  const createDate = vnPayDate(new Date());
  const orderInfo = `Query ${providerPaymentId}`;
  const secureHashInput = [
    requestId,
    "2.1.0",
    "querydr",
    required(vnPayTmnCode, "vnpay_tmn_code"),
    providerPaymentId,
    transactionDate,
    createDate,
    metadata.clientIp ?? "127.0.0.1",
    orderInfo,
  ].join("|");
  const payload = await fetchJson(required(vnPayApiUrl, "vnpay_api_url"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vnp_RequestId: requestId,
      vnp_Version: "2.1.0",
      vnp_Command: "querydr",
      vnp_TmnCode: required(vnPayTmnCode, "vnpay_tmn_code"),
      vnp_TxnRef: providerPaymentId,
      vnp_OrderInfo: orderInfo,
      vnp_TransactionDate: transactionDate,
      vnp_CreateDate: createDate,
      vnp_IpAddr: String(metadata.clientIp ?? "127.0.0.1"),
      vnp_SecureHash: hmac(
        "sha512",
        required(vnPayHashSecret, "vnpay_hash_secret"),
        secureHashInput,
      ),
    }),
  });
  return {
    providerTransactionId: payload.vnp_TransactionNo
      ? String(payload.vnp_TransactionNo)
      : undefined,
    status:
      payload.vnp_ResponseCode === "00" &&
      payload.vnp_TransactionStatus === "00"
        ? "succeeded"
        : "failed",
    amount: Number(payload.vnp_Amount)
      ? Number(payload.vnp_Amount) / 100
      : undefined,
    raw: payload,
  };
}

export function verifyStripeWebhook(payload: string, signature: string) {
  return stripe().webhooks.constructEvent(
    payload,
    signature,
    required(stripeWebhookSecret, "stripe_webhook_secret"),
  );
}

export function verifyMomoWebhook(payload: Record<string, unknown>) {
  if (payload.partnerCode !== required(momoPartnerCode, "momo_partner_code"))
    return false;
  const accessKey = required(momoAccessKey, "momo_access_key");
  const signature = String(payload.signature ?? "");
  const raw = [
    `accessKey=${accessKey}`,
    `amount=${String(payload.amount ?? "")}`,
    `extraData=${String(payload.extraData ?? "")}`,
    `message=${String(payload.message ?? "")}`,
    `orderId=${String(payload.orderId ?? "")}`,
    `orderInfo=${String(payload.orderInfo ?? "")}`,
    `orderType=${String(payload.orderType ?? "")}`,
    `partnerCode=${String(payload.partnerCode ?? "")}`,
    `payType=${String(payload.payType ?? "")}`,
    `requestId=${String(payload.requestId ?? "")}`,
    `responseTime=${String(payload.responseTime ?? "")}`,
    `resultCode=${String(payload.resultCode ?? "")}`,
    `transId=${String(payload.transId ?? "")}`,
  ].join("&");
  return constantTimeEqual(
    signature,
    hmac("sha256", required(momoSecretKey, "momo_secret_key"), raw),
  );
}

export function verifyZaloPayWebhook(data: string, mac: string) {
  if (
    !constantTimeEqual(
      mac,
      hmac("sha256", required(zaloPayMerchantKey2, "zalopay_key2"), data),
    )
  )
    return false;
  try {
    return (
      String(JSON.parse(data).app_id) ===
      required(zaloPayMerchantAppId, "zalopay_app_id")
    );
  } catch {
    return false;
  }
}

export function verifyVnPayParameters(parameters: Record<string, string>) {
  if (parameters.vnp_TmnCode !== required(vnPayTmnCode, "vnpay_tmn_code"))
    return false;
  const signature = parameters.vnp_SecureHash ?? "";
  const unsigned = Object.fromEntries(
    Object.entries(parameters).filter(
      ([key]) => key !== "vnp_SecureHash" && key !== "vnp_SecureHashType",
    ),
  );
  return constantTimeEqual(
    signature.toLowerCase(),
    hmac(
      "sha512",
      required(vnPayHashSecret, "vnpay_hash_secret"),
      serializeVnPay(unsigned),
    ),
  );
}

export async function cancelProviderPayment(
  provider: ProviderCode,
  providerPaymentId: string,
) {
  if (provider !== "stripe")
    throw new ServiceError("provider_cancel_not_supported", 422);
  const intent = await stripe().paymentIntents.cancel(providerPaymentId);
  return {
    status: mapStripeStatus(intent.status),
    raw: { id: intent.id, status: intent.status },
  };
}

export async function refundProviderPayment(
  provider: ProviderCode,
  providerPaymentId: string,
  amount: number,
  paymentId: string,
  context?: RefundProviderContext,
) {
  if (!context?.refundId)
    throw new ServiceError("refund_provider_context_required", 422);
  if (provider === "stripe") {
    const refund = await stripe().refunds.create(
      { payment_intent: providerPaymentId, amount, metadata: { paymentId } },
      { idempotencyKey: context.refundId },
    );
    return {
      id: refund.id,
      status: refund.status ?? "processing",
      raw: { id: refund.id, status: refund.status },
    };
  }
  if (!context?.providerTransactionId || context.currency !== "VND")
    throw new ServiceError("refund_provider_context_required", 422);
  const requestId = context.refundId.replaceAll("-", "");
  const description = "Merchant refund";
  if (provider === "momo") {
    const values = {
      accessKey: required(momoAccessKey, "momo_access_key"),
      amount,
      description,
      orderId: requestId,
      partnerCode: required(momoPartnerCode, "momo_partner_code"),
      requestId,
      transId: context.providerTransactionId,
    };
    const signature = hmac(
      "sha256",
      required(momoSecretKey, "momo_secret_key"),
      Object.entries(values)
        .map(([key, value]) => `${key}=${value}`)
        .join("&"),
    );
    const payload = await fetchJson(
      `${required(momoApiUrl, "momo_api_url").replace(/\/+$/, "")}/v2/gateway/api/refund`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          accessKey: undefined,
          signature,
          lang: "en",
        }),
      },
    );
    if (
      String(payload.requestId) !== requestId ||
      String(payload.orderId) !== requestId
    )
      throw new ServiceError("refund_response_mismatch", 502);
    return {
      id: requestId,
      status: momoRefundStatus(payload.resultCode),
      raw: { resultCode: payload.resultCode, refundTransId: payload.transId },
    };
  }
  if (provider === "zalopay") {
    const appId = required(zaloPayMerchantAppId, "zalopay_app_id");
    const timestamp = Date.now();
    const id = refundRequestReference(
      provider,
      context.refundId,
      context.createdAt,
    )!;
    const mac = hmac(
      "sha256",
      required(zaloPayMerchantKey1, "zalopay_key1"),
      `${appId}|${context.providerTransactionId}|${amount}|${description}|${timestamp}`,
    );
    const payload = await fetchJson(
      `${required(zaloPayApiUrl, "zalopay_api_url").replace(/\/+$/, "")}/v2/refund`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          app_id: appId,
          m_refund_id: id,
          timestamp: String(timestamp),
          zp_trans_id: context.providerTransactionId,
          amount: String(amount),
          description,
          mac,
        }),
      },
    );
    return {
      id,
      status: zaloRefundStatus(payload),
      raw: {
        return_code: payload.return_code,
        sub_return_code: payload.sub_return_code,
        refund_id: payload.refund_id,
      },
    };
  }
  // VNPay requires original merchant creation time and transaction number.
  const transactionDate = String(context.metadata.vnpCreateDate ?? "");
  if (!/^\d{14}$/.test(transactionDate))
    throw new ServiceError("missing_vnpay_transaction_date", 422);
  const values = {
    vnp_RequestId: requestId,
    vnp_Version: "2.1.0",
    vnp_Command: "refund",
    vnp_TmnCode: required(vnPayTmnCode, "vnpay_tmn_code"),
    vnp_TransactionType: context.full ? "02" : "03",
    vnp_TxnRef: providerPaymentId,
    vnp_Amount: String(amount * 100),
    vnp_TransactionNo: context.providerTransactionId,
    vnp_TransactionDate: transactionDate,
    vnp_CreateBy: "merchant",
    vnp_CreateDate: vnPayDate(new Date()),
    vnp_IpAddr: String(context.metadata.clientIp ?? "127.0.0.1"),
    vnp_OrderInfo: description,
  };
  if (!Number.isSafeInteger(amount * 100))
    throw new ServiceError("invalid_refund_amount", 422);
  const signature = hmac(
    "sha512",
    required(vnPayHashSecret, "vnpay_hash_secret"),
    Object.values(values).join("|"),
  );
  const payload = await fetchJson(required(vnPayApiUrl, "vnpay_api_url"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...values, vnp_SecureHash: signature }),
  });
  const responseKeys = [
    "vnp_ResponseId",
    "vnp_Command",
    "vnp_ResponseCode",
    "vnp_Message",
    "vnp_TmnCode",
    "vnp_TxnRef",
    "vnp_Amount",
    "vnp_BankCode",
    "vnp_PayDate",
    "vnp_TransactionNo",
    "vnp_TransactionType",
    "vnp_TransactionStatus",
    "vnp_OrderInfo",
  ];
  const responseSignature = hmac(
    "sha512",
    required(vnPayHashSecret, "vnpay_hash_secret"),
    responseKeys.map((key) => String(payload[key] ?? "")).join("|"),
  );
  if (
    !constantTimeEqual(
      String(payload.vnp_SecureHash ?? "").toLowerCase(),
      responseSignature,
    ) ||
    payload.vnp_Command !== "refund" ||
    payload.vnp_TmnCode !== values.vnp_TmnCode ||
    payload.vnp_TransactionType !== values.vnp_TransactionType ||
    payload.vnp_TxnRef !== providerPaymentId ||
    Number(payload.vnp_Amount) !== amount * 100
  )
    throw new ServiceError("invalid_refund_response", 502);
  return {
    id: requestId,
    status:
      payload.vnp_ResponseCode === "00" &&
      payload.vnp_TransactionStatus === "00"
        ? "succeeded"
        : payload.vnp_ResponseCode === "00"
          ? "processing"
          : "failed",
    raw: {
      responseCode: payload.vnp_ResponseCode,
      transactionStatus: payload.vnp_TransactionStatus,
    },
  };
}

export interface RefundProviderContext {
  refundId: string;
  providerTransactionId?: string;
  currency: string;
  full: boolean;
  createdAt: Date;
  metadata: Record<string, unknown>;
}

export function refundRequestReference(
  provider: ProviderCode,
  id: string,
  createdAt: Date,
) {
  if (provider === "stripe") return undefined;
  const compact = id.replaceAll("-", "");
  return provider === "zalopay"
    ? `${vnPayDate(createdAt).slice(2, 8)}_${required(zaloPayMerchantAppId, "zalopay_app_id")}_${compact.slice(0, 24)}`
    : compact;
}
export function momoRefundStatus(
  code: unknown,
): "succeeded" | "processing" | "failed" {
  if (Number(code) === 0) return "succeeded";
  // Unknown/operational errors do not prove that a reserved refund did not run.
  return [1080, 1081, 1088, 1002, 1003].includes(Number(code))
    ? "failed"
    : "processing";
}
export function zaloRefundStatus(
  payload: Record<string, unknown>,
): "succeeded" | "processing" | "failed" {
  if (Number(payload.return_code) === 1) return "succeeded";
  if (
    Number(payload.return_code) === 2 &&
    [-2, -13, -14, -32].includes(Number(payload.sub_return_code))
  )
    return "failed";
  return "processing";
}

export async function queryProviderRefund(provider: ProviderCode, id: string) {
  if (provider === "stripe") {
    const result = await stripe().refunds.retrieve(id);
    return result.status === "succeeded"
      ? "succeeded"
      : ["failed", "canceled"].includes(result.status ?? "")
        ? "failed"
        : "processing";
  }
  if (provider === "momo") {
    const values = {
      accessKey: required(momoAccessKey, "momo_access_key"),
      orderId: id,
      partnerCode: required(momoPartnerCode, "momo_partner_code"),
      requestId: randomUUID(),
    };
    const signature = hmac(
      "sha256",
      required(momoSecretKey, "momo_secret_key"),
      Object.entries(values)
        .map(([key, value]) => `${key}=${value}`)
        .join("&"),
    );
    const result = await fetchJson(
      `${required(momoApiUrl, "momo_api_url").replace(/\/+$/, "")}/v2/gateway/api/refund/query`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          accessKey: undefined,
          lang: "en",
          signature,
        }),
      },
    );
    if (
      String(result.orderId) !== id ||
      String(result.requestId) !== values.requestId
    )
      throw new ServiceError("refund_response_mismatch", 502);
    return momoRefundStatus(result.resultCode);
  }
  if (provider === "zalopay") {
    const appId = required(zaloPayMerchantAppId, "zalopay_app_id"),
      timestamp = String(Date.now());
    const mac = hmac(
      "sha256",
      required(zaloPayMerchantKey1, "zalopay_key1"),
      `${appId}|${id}|${timestamp}`,
    );
    const result = await fetchJson(
      `${required(zaloPayApiUrl, "zalopay_api_url").replace(/\/+$/, "")}/v2/query_refund`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          app_id: appId,
          m_refund_id: id,
          timestamp,
          mac,
        }),
      },
    );
    return zaloRefundStatus(result);
  }
  // VNPay uncertain refunds require merchant reconciliation; never guess success.
  return "processing";
}
