import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  resume: vi.fn(),
  rows: [] as unknown[][],
  updates: [] as Record<string, unknown>[],
  transaction: vi.fn(),
  insert: vi.fn(),
}));
vi.mock("@/services/provider", () => ({
  resumeProviderCheckout: state.resume,
  createProviderPayment: vi.fn(),
  cancelProviderPayment: vi.fn(),
  queryProviderPayment: vi.fn(),
  refundProviderPayment: vi.fn(),
}));
vi.mock("@/database", () => {
  const db = {
    select() {
      const q = {
        from: () => q,
        where: () => q,
        limit: () => q,
        for: () => q,
        then(resolve: (value: unknown[]) => unknown) {
          return Promise.resolve(state.rows.shift() ?? []).then(resolve);
        },
      };
      return q;
    },
    insert: () => ({
      values(value: unknown) {
        state.insert(value);
        return {
          onConflictDoNothing: async () => undefined,
          then(resolve: (value: unknown) => unknown) {
            return Promise.resolve(undefined).then(resolve);
          },
        };
      },
    }),
    update: () => ({
      set(value: Record<string, unknown>) {
        state.updates.push(value);
        return {
          where: () => ({
            returning: async () => state.rows.shift() ?? [],
            then(resolve: (value: unknown) => unknown) {
              return Promise.resolve(undefined).then(resolve);
            },
          }),
        };
      },
    }),
    transaction: state.transaction,
  };
  state.transaction.mockImplementation(async (fn) => fn(db));
  return { database: db };
});
import {
  rawProcessProviderEvent,
  rawRefundPayment,
  rawCreatePayment,
} from "@/models/payments";
const event = () => ({
  provider: "stripe" as const,
  providerEventId: "evt_1",
  eventType: "payment_intent.succeeded",
  providerPaymentId: "pi_1",
  status: "succeeded" as const,
  amount: 1000,
  payload: {},
});
const payment = () => ({
  id: "payment",
  amount: 1000,
  amountCaptured: 0,
  status: "processing",
  providerPaymentId: "pi_1",
});
beforeEach(() => {
  vi.clearAllMocks();
  state.rows = [];
  state.updates = [];
});
it("acknowledges processed duplicate receipts without reapplying money changes", async () => {
  state.rows = [[{ id: "receipt", status: "processed" }]];
  expect(await rawProcessProviderEvent(event())).toEqual({ duplicate: true });
  expect(state.updates).toEqual([]);
});
it("does not mark a failed receipt processed, allowing provider redelivery", async () => {
  state.rows = [[{ id: "receipt", status: "failed" }], []];
  await expect(rawProcessProviderEvent(event())).rejects.toThrow(
    "payment_not_found",
  );
  expect(state.updates.some((row) => row.status === "processed")).toBe(false);
  state.rows = [
    [{ id: "receipt", status: "failed" }],
    [payment()],
    [payment()],
    [{ ...payment(), status: "succeeded" }],
  ];
  expect(await rawProcessProviderEvent(event())).toMatchObject({
    duplicate: false,
    payment: { status: "succeeded" },
  });
  expect(state.updates.some((row) => row.status === "processed")).toBe(true);
});
it("rejects mismatched provider amounts before updating a payment", async () => {
  state.rows = [[{ id: "receipt", status: "pending" }], [payment()]];
  await expect(
    rawProcessProviderEvent({ ...event(), amount: 999 }),
  ).rejects.toThrow("provider_amount_mismatch");
  expect(state.updates).toEqual([]);
});
it("does not regress a captured payment when an old failure arrives", async () => {
  state.rows = [
    [{ id: "receipt", status: "pending" }],
    [{ ...payment(), status: "succeeded" }],
    [{ ...payment(), status: "succeeded" }],
  ];
  expect(
    await rawProcessProviderEvent({ ...event(), status: "failed" }),
  ).toMatchObject({ payment: { status: "succeeded" } });
  expect(state.updates).not.toContainEqual(
    expect.objectContaining({ status: "failed" }),
  );
});
it("requires administrator authority and idempotency for refunds", async () => {
  await expect(
    rawRefundPayment("id", {}, { user: { role: "user" } } as never, "key"),
  ).rejects.toThrow("refund_forbidden");
  await expect(
    rawRefundPayment("id", {}, { user: { role: "admin" } } as never, ""),
  ).rejects.toThrow("invalid_idempotency_key");
});
it("reserves pending refunds when calculating the remaining refundable amount", async () => {
  state.rows = [
    [
      {
        ...payment(),
        application: "video",
        amountCaptured: 1000,
        amountRefunded: 0,
        status: "succeeded",
      },
    ],
    [],
    [{ amount: 400 }],
  ];
  await expect(
    rawRefundPayment(
      "payment",
      { amount: 800 },
      { application: "video", user: { role: "admin", id: "admin" } } as never,
      "key",
    ),
  ).rejects.toThrow("refund_amount_exceeds_payment");
});
it("rejects reuse of a refund key with a different amount", async () => {
  state.rows = [
    [{ ...payment(), application: "video" }],
    [{ id: "refund", amount: 100 }],
  ];
  await expect(
    rawRefundPayment(
      "payment",
      { amount: 200 },
      { application: "video", user: { role: "admin", id: "admin" } } as never,
      "key",
    ),
  ).rejects.toThrow("idempotency_conflict");
});

it("reuses an owner-checked pending checkout without creating another charge", async () => {
  const input = {
    application: "task",
    referenceType: "invoice",
    referenceId: "invoice",
    provider: "stripe" as const,
    amount: 1200,
    currency: "USD",
  };
  state.rows = [
    [
      {
        ...input,
        id: "payment",
        idempotencyKey: "same-key",
        userId: "buyer",
        providerPaymentId: "pi_1",
        status: "requires_action",
        metadata: {},
      },
    ],
  ];
  state.resume.mockResolvedValue({
    clientSecret: "scoped-checkout",
    publishableKey: "pk_fixture",
  });
  const result = await rawCreatePayment(input, "same-key", "127.0.0.1", {
    application: "task",
    user: { id: "buyer", role: "user" },
  } as never);
  expect(result).toMatchObject({
    reused: true,
    checkout: { clientSecret: "scoped-checkout" },
  });
  expect(state.insert).not.toHaveBeenCalled();
});
it("rejects idempotent payment replay with a modified amount or order binding", async () => {
  const input = {
    application: "task",
    referenceType: "invoice",
    referenceId: "invoice",
    provider: "stripe" as const,
    amount: 1200,
    currency: "USD",
  };
  state.rows = [
    [
      {
        ...input,
        id: "payment",
        userId: "buyer",
        amount: 1,
        status: "requires_action",
        metadata: {},
      },
    ],
  ];
  await expect(
    rawCreatePayment(input, "same-key", "127.0.0.1", {
      application: "task",
      user: { id: "buyer", role: "user" },
    } as never),
  ).rejects.toThrow("idempotency_conflict");
  expect(state.resume).not.toHaveBeenCalled();
});
