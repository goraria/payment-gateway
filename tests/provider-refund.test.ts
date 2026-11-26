import { createHmac } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  stripeCreate: vi.fn(),
  stripeGet: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("stripe", () => ({
  default: class {
    refunds = { create: fixture.stripeCreate, retrieve: fixture.stripeGet };
    paymentIntents = { cancel: fixture.cancel };
  },
}));
vi.mock("@/utils/environment", () => ({
  oauthClientBindings: undefined,
  stripeSecretKey: "test-stripe",
  stripePublishableKey: "test-public",
  stripeWebhookSecret: "test-webhook",
  momoApiUrl: "https://momo.example",
  momoPartnerCode: "partner",
  momoAccessKey: "access",
  momoSecretKey: "test-momo-secret",
  momoPartnerName: "Test",
  momoStoreId: "store",
  momoRedirectUrl: "https://return.example",
  momoIpnUrl: "https://ipn.example",
  zaloPayApiUrl: "https://zalopay.example",
  zaloPayAppId: "2553",
  zaloPayKey1: "test-zalo-key1",
  zaloPayKey2: "test-zalo-key2",
  zaloPayCallbackUrl: "https://ipn.example",
  zaloPayRedirectUrl: "https://return.example",
  vnPayPaymentUrl: "https://vnpay.example",
  vnPayApiUrl: "https://vnpay.example/api",
  vnPayTmnCode: "merchant",
  vnPayHashSecret: "test-vnpay-key",
  vnPayReturnUrl: "https://return.example",
  vnPayLocale: "vn",
}));
import {
  cancelProviderPayment,
  queryProviderRefund,
  refundProviderPayment,
  verifyMomoWebhook,
  verifyZaloPayWebhook,
  momoRefundStatus,
  zaloRefundStatus,
} from "@/services/provider";
const refundId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const requestId = refundId.replaceAll("-", "");
const context = () => ({
  refundId,
  providerTransactionId: "123456",
  currency: "VND",
  full: false,
  createdAt: new Date("2026-10-20T00:00:00Z"),
  metadata: { vnpCreateDate: "20261020070000", clientIp: "127.0.0.1" },
});
const mac = (key: string, value: string) =>
  createHmac("sha256", key).update(value).digest("hex");
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("unexpected real provider request"),
  );
});
it("uses one stable Stripe idempotency key per reserved refund", async () => {
  fixture.stripeCreate.mockResolvedValue({ id: "re_1", status: "succeeded" });
  expect(
    await refundProviderPayment("stripe", "pi_1", 1000, "payment", context()),
  ).toMatchObject({ id: "re_1", status: "succeeded" });
  expect(fixture.stripeCreate).toHaveBeenCalledWith(
    expect.objectContaining({ amount: 1000, payment_intent: "pi_1" }),
    { idempotencyKey: refundId },
  );
});
it("signs a MoMo refund with a new stable order/request id and original transaction", async () => {
  vi.mocked(fetch).mockResolvedValue(
    Response.json({ orderId: requestId, requestId, resultCode: 0 }),
  );
  expect(
    await refundProviderPayment(
      "momo",
      "original-order",
      1000,
      "payment",
      context(),
    ),
  ).toMatchObject({ id: requestId, status: "succeeded" });
  const [url, options] = vi.mocked(fetch).mock.calls[0]!;
  expect(String(url)).toBe("https://momo.example/v2/gateway/api/refund");
  const body = JSON.parse(String(options!.body));
  expect(body.signature).toBe(
    mac(
      "test-momo-secret",
      `accessKey=access&amount=1000&description=Merchant refund&orderId=${requestId}&partnerCode=partner&requestId=${requestId}&transId=123456`,
    ),
  );
  expect(options!.redirect).toBe("error");
});
it("keeps a ZaloPay accepted-but-not-final refund processing", async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json({ return_code: 3 }));
  const result = await refundProviderPayment(
    "zalopay",
    "original-order",
    1000,
    "payment",
    context(),
  );
  expect(result.status).toBe("processing");
  const body = vi.mocked(fetch).mock.calls[0]![1]!.body as URLSearchParams;
  expect(body.get("m_refund_id")).toMatch(/^261020_2553_/);
  expect(body.get("mac")).toBe(
    mac(
      "test-zalo-key1",
      `2553|123456|1000|Merchant refund|${body.get("timestamp")}`,
    ),
  );
});
it("rejects foreign MoMo responses and missing original transaction context", async () => {
  vi.mocked(fetch).mockResolvedValue(
    Response.json({ orderId: "foreign", requestId, resultCode: 0 }),
  );
  await expect(
    refundProviderPayment("momo", "order", 1000, "payment", context()),
  ).rejects.toThrow("refund_response_mismatch");
  await expect(
    refundProviderPayment("zalopay", "order", 1000, "payment"),
  ).rejects.toThrow("refund_provider_context_required");
});
it("requires an authenticated VNPay refund response", async () => {
  vi.mocked(fetch).mockResolvedValue(
    Response.json({
      vnp_ResponseCode: "00",
      vnp_TransactionStatus: "00",
      vnp_TxnRef: "order",
      vnp_Amount: "100000",
      vnp_SecureHash: "bad",
    }),
  );
  await expect(
    refundProviderPayment("vnpay", "order", 1000, "payment", context()),
  ).rejects.toThrow("invalid_refund_response");
});
it("maps final asynchronous refunds without guessing success", async () => {
  fixture.stripeGet.mockResolvedValue({ status: "failed" });
  expect(await queryProviderRefund("stripe", "re_1")).toBe("failed");
  vi.mocked(fetch).mockResolvedValue(Response.json({ return_code: 1 }));
  expect(await queryProviderRefund("zalopay", "refund")).toBe("succeeded");
  expect(await queryProviderRefund("vnpay", "refund")).toBe("processing");
});
it.each(["momo", "zalopay", "vnpay"] as const)(
  "fails explicitly rather than inventing cancellation for %s",
  async (provider) => {
    await expect(cancelProviderPayment(provider, "order")).rejects.toThrow(
      "provider_cancel_not_supported",
    );
    expect(fetch).not.toHaveBeenCalled();
  },
);
it("validates ZaloPay MAC and rejects malformed MoMo signatures", () => {
  const data = '{"app_id":2553,"amount":1000}';
  expect(verifyZaloPayWebhook(data, mac("test-zalo-key2", data))).toBe(true);
  expect(verifyZaloPayWebhook(data, "wrong")).toBe(false);
  expect(verifyMomoWebhook({ signature: "" })).toBe(false);
});
it("keeps pending/maintenance provider responses reserved instead of falsely failing them", () => {
  for (const code of [1000, 7000, 7002, 9000, 999999])
    expect(momoRefundStatus(code)).toBe("processing");
  expect(momoRefundStatus(1080)).toBe("failed");
  expect(zaloRefundStatus({ return_code: 2, sub_return_code: -1 })).toBe(
    "processing",
  );
  expect(zaloRefundStatus({ return_code: 2, sub_return_code: -16 })).toBe(
    "processing",
  );
  expect(zaloRefundStatus({ return_code: 2, sub_return_code: -14 })).toBe(
    "failed",
  );
});
