import { and, count, desc, eq, inArray, sql } from "drizzle-orm";

import { database } from "@/database";
import {
  paymentHistoryTable,
  paymentsTable,
  paymentTransactionsTable,
  refundsTable,
  webhookEventsTable,
  usersTable,
  type Payment,
} from "@/database/schema";
import { ServiceError } from "@/lib/errors";
import type {
  CreatePaymentInput,
  ListPaymentInput,
  RefundPaymentInput,
} from "@/schemas/payment";
import {
  cancelProviderPayment,
  createProviderPayment,
  queryProviderPayment,
  refundProviderPayment,
  refundRequestReference,
  resumeProviderCheckout,
  type NormalizedProviderStatus,
  type ProviderCode,
} from "@/services/provider";
import type { AuthContext } from "@/types/auth";
import { authoritativePaymentInput,authoritativeRefund,isCommerceOrder } from '@/services/commerce-order';
import type { RawCreatePaymentInput } from '@/schemas/payment';
import { rawEnqueueCommerce } from '@/models/commerce-delivery';

function canManageAll(auth: AuthContext) {
  return auth.user.role === "admin" || auth.user.role === "master";
}

function assertOwner(payment: Payment, auth: AuthContext) {
  if (payment.userId !== auth.user.id && !canManageAll(auth)) {
    throw new ServiceError("payment_forbidden", 403);
  }
}

export async function rawListPayments(input: ListPaymentInput, auth: AuthContext) {
  const filters = canManageAll(auth)
    ? []
    : [eq(paymentsTable.userId, auth.user.id)];
  if (input.status) filters.push(eq(paymentsTable.status, input.status));
  if (input.referenceType)
    filters.push(eq(paymentsTable.referenceType, input.referenceType));
  if (input.referenceId)
    filters.push(eq(paymentsTable.referenceId, input.referenceId));
  const where = filters.length ? and(...filters) : undefined;
  const [data, totals] = await Promise.all([
    database
      .select()
      .from(paymentsTable)
      .where(where)
      .orderBy(desc(paymentsTable.createdAt))
      .limit(input.limit)
      .offset(input.offset),
    database.select({ total: count() }).from(paymentsTable).where(where),
  ]);
  const total = Number(totals[0]?.total ?? 0);
  return {
    data,
    pagination: {
      limit: input.limit,
      offset: input.offset,
      total,
      hasMore: input.offset + data.length < total,
    },
  };
}

export async function rawGetPayment(id: string, auth: AuthContext) {
  const [payment] = await database
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.id, id))
    .limit(1);
  if (!payment) throw new ServiceError("payment_not_found", 404);
  assertOwner(payment, auth);

  const [transactions, refunds, history] = await Promise.all([
    database
      .select()
      .from(paymentTransactionsTable)
      .where(eq(paymentTransactionsTable.paymentId, id))
      .orderBy(desc(paymentTransactionsTable.createdAt)),
    database
      .select()
      .from(refundsTable)
      .where(eq(refundsTable.paymentId, id))
      .orderBy(desc(refundsTable.createdAt)),
    database
      .select()
      .from(paymentHistoryTable)
      .where(eq(paymentHistoryTable.paymentId, id))
      .orderBy(desc(paymentHistoryTable.createdAt)),
  ]);
  return { ...payment, transactions, refunds, history };
}

export async function rawCreatePayment(
  rawInput: RawCreatePaymentInput,
  idempotencyKey: string,
  clientIp: string,
  auth: AuthContext,
) {
  if(auth.application!==rawInput.application&&!canManageAll(auth))throw new ServiceError('application_client_mismatch',403);
  const input:CreatePaymentInput=await authoritativePaymentInput(rawInput,auth);
  if(isCommerceOrder(input)) idempotencyKey='commerce-order:'+input.referenceId;
  if (!idempotencyKey || idempotencyKey.length > 255) {
    throw new ServiceError("invalid_idempotency_key", 400);
  }
  if (auth.application !== input.application && !canManageAll(auth)) {
    throw new ServiceError("application_client_mismatch", 403);
  }

  const [existing] = await database
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.idempotencyKey, idempotencyKey))
    .limit(1);
  if (existing) {
    assertOwner(existing, auth);
    if (
      existing.application !== input.application ||
      existing.referenceType !== input.referenceType ||
      existing.referenceId !== input.referenceId ||
      existing.amount !== input.amount ||
      existing.currency !== input.currency ||
      existing.provider !== input.provider
    )
      throw new ServiceError("idempotency_conflict", 409);
    const checkout =
      existing.status === "requires_action"
        ? await resumeProviderCheckout(
            existing.provider,
            existing.providerPaymentId,
            existing.metadata as Record<string, unknown>,
          )
        : undefined;
    return { payment: existing, checkout, reused: true };
  }

  if(isCommerceOrder(input)&&input.metadata?.payable!==true)throw new ServiceError('order_not_payable',409);
  const [payment] = await database
    .insert(paymentsTable)
    .values({
      userId: auth.user.id,
      application: input.application,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      provider: input.provider,
      idempotencyKey,
      amount: input.amount,
      currency: input.currency,
      description: input.description,
      metadata: input.metadata ?? {},
    })
    .onConflictDoNothing({ target: paymentsTable.idempotencyKey })
    .returning();

  if (!payment) {
    const [concurrent] = await database
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.idempotencyKey, idempotencyKey))
      .limit(1);
    if (!concurrent) throw new ServiceError("payment_create_conflict", 409);
    assertOwner(concurrent, auth);
    if (
      concurrent.application !== input.application ||
      concurrent.referenceType !== input.referenceType ||
      concurrent.referenceId !== input.referenceId ||
      concurrent.amount !== input.amount ||
      concurrent.currency !== input.currency ||
      concurrent.provider !== input.provider
    )
      throw new ServiceError("idempotency_conflict", 409);
    const checkout =
      concurrent.status === "requires_action"
        ? await resumeProviderCheckout(
            concurrent.provider,
            concurrent.providerPaymentId,
            concurrent.metadata as Record<string, unknown>,
          )
        : undefined;
    return { payment: concurrent, checkout, reused: true };
  }

  try {
    const provider = await createProviderPayment({
      ...input,
      paymentId: payment.id,
      idempotencyKey,
      clientIp,
    });
    const providerMetadata = {
      ...(input.metadata ?? {}),
      checkoutUrl: provider.checkoutUrl ?? null,
      providerData: provider.raw,
      clientIp,
      ...(input.provider === "vnpay" &&
      typeof provider.raw.vnp_CreateDate === "string"
        ? { vnpCreateDate: provider.raw.vnp_CreateDate }
        : {}),
    };
    const [updated] = await database.transaction(async (transaction) => {
      const records = await transaction
        .update(paymentsTable)
        .set({
          providerPaymentId: provider.providerPaymentId,
          status: provider.status,
          metadata: providerMetadata,
          updatedAt: new Date(),
        })
        .where(eq(paymentsTable.id, payment.id))
        .returning();
      await transaction.insert(paymentHistoryTable).values({
        paymentId: payment.id,
        eventType: "payment.created",
        fromStatus: "pending",
        toStatus: provider.status,
        providerReference: provider.providerPaymentId,
        data: provider.raw,
      });
      if(provider.status==='succeeded')await rawEnqueueCommerce(transaction,records[0]!, 'capture');
      if(provider.status==='failed'||provider.status==='cancelled')await rawEnqueueCommerce(transaction,records[0]!, 'failed');
      return records;
    });
    if (!updated) throw new ServiceError("payment_create_failed", 502);
    return {
      payment: updated,
      checkout: {
        url: provider.checkoutUrl,
        clientSecret: provider.clientSecret,
        publishableKey: provider.publishableKey,
      },
      reused: false,
    };
  } catch (error) {
    await database.transaction(async tx=>{
    await tx.update(paymentsTable)
      .set({
        status: "failed",
        failureCode: "provider_create_failed",
        failureMessage: "provider_create_failed",
        updatedAt: new Date(),
      })
      .where(eq(paymentsTable.id, payment.id));
    await rawEnqueueCommerce(tx,payment,'failed');
    });
    throw error instanceof ServiceError
      ? error
      : new ServiceError("provider_create_failed", 502);
  }
}

async function applyProviderStatus(
  payment: Payment,
  status: NormalizedProviderStatus,
  providerTransactionId: string | undefined,
  amount: number | undefined,
  eventType: string,
  raw: Record<string, unknown>,
  existingTransaction?: Parameters<
    Parameters<typeof database.transaction>[0]
  >[0],
) {
  if (amount !== undefined && amount !== payment.amount) {
    throw new ServiceError("provider_amount_mismatch", 409);
  }
  const now = new Date();
  const apply = async (
    transaction: Parameters<Parameters<typeof database.transaction>[0]>[0],
  ) => {
    const [locked] = await transaction
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.id, payment.id))
      .for("update");
    if (!locked) throw new ServiceError("payment_not_found", 404);
    payment = locked;
    // A successful capture/refund cannot regress when webhooks arrive out of order.
    if (
      payment.status === status ||
      (["succeeded", "partially_refunded", "refunded"].includes(
        payment.status,
      ) &&
        payment.status !== status)
    )
      return [payment];
    const rows = await transaction
      .update(paymentsTable)
      .set({
        status,
        amountCaptured:
          status === "succeeded" ? payment.amount : payment.amountCaptured,
        authorizedAt: status === "authorized" ? now : payment.authorizedAt,
        capturedAt: status === "succeeded" ? now : payment.capturedAt,
        cancelledAt: status === "cancelled" ? now : payment.cancelledAt,
        failureCode:
          status === "failed"
            ? String(raw.resultCode ?? raw.return_code ?? "provider_failed")
            : null,
        failureMessage:
          status === "failed"
            ? String(raw.message ?? raw.return_message ?? "payment_failed")
            : null,
        updatedAt: now,
      })
      .where(eq(paymentsTable.id, payment.id))
      .returning();

    if (
      status === "succeeded" ||
      status === "authorized" ||
      status === "failed"
    ) {
      await transaction
        .insert(paymentTransactionsTable)
        .values({
          paymentId: payment.id,
          providerTransactionId,
          type: status === "authorized" ? "authorization" : "charge",
          status: status === "failed" ? "failed" : "succeeded",
          amount: payment.amount,
          currency: payment.currency,
          metadata: raw,
          processedAt: now,
        })
        .onConflictDoNothing();
    }
    await transaction.insert(paymentHistoryTable).values({
      paymentId: payment.id,
      eventType,
      fromStatus: payment.status,
      toStatus: status,
      providerReference: providerTransactionId ?? payment.providerPaymentId,
      data: raw,
    });
    if(status==='succeeded')await rawEnqueueCommerce(transaction,rows[0]!, 'capture');
    if(status==='failed'||status==='cancelled')await rawEnqueueCommerce(transaction,rows[0]!, 'failed');
    return rows;
  };
  const [updated] = existingTransaction
    ? await apply(existingTransaction)
    : await database.transaction(apply);
  if (!updated) throw new ServiceError("payment_update_failed", 409);
  return updated;
}

export async function rawQueryPayment(id: string, auth: AuthContext) {
  const [payment] = await database
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.id, id))
    .limit(1);
  if (!payment) throw new ServiceError("payment_not_found", 404);
  assertOwner(payment, auth);
  return queryStoredPayment(payment);
}
// Worker-only reconciliation; public routes still go through queryPayment ownership.
export async function rawReconcileProviderPayment(id:string){
  const [p]=await database.select().from(paymentsTable).where(eq(paymentsTable.id,id)).limit(1);
  if(!p)throw new ServiceError('payment_not_found',404);
  return queryStoredPayment(p);
}
async function queryStoredPayment(payment:Payment){
  if (!payment.providerPaymentId)
    throw new ServiceError("provider_payment_missing", 409);
  const result = await queryProviderPayment(
    payment.provider as ProviderCode,
    payment.providerPaymentId,
    payment.metadata as Record<string, unknown>,
  );
  return applyProviderStatus(
    payment,
    result.status,
    result.providerTransactionId,
    result.amount,
    "payment.queried",
    result.raw,
  );
}

export async function rawCancelPayment(id: string, auth: AuthContext) {
  const [payment] = await database
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.id, id))
    .limit(1);
  if (!payment) throw new ServiceError("payment_not_found", 404);
  assertOwner(payment, auth);
  if (!payment.providerPaymentId)
    throw new ServiceError("provider_payment_missing", 409);
  if (
    !["pending", "requires_action", "authorized", "processing"].includes(
      payment.status,
    )
  ) {
    throw new ServiceError("payment_cannot_be_cancelled", 409);
  }
  const result = await cancelProviderPayment(
    payment.provider as ProviderCode,
    payment.providerPaymentId,
  );
  return applyProviderStatus(
    payment,
    result.status,
    undefined,
    undefined,
    "payment.cancelled",
    result.raw,
  );
}

export async function rawRefundPayment(id:string,input:RefundPaymentInput,auth:AuthContext,idempotencyKey:string){return requestRefund(id,input,auth,idempotencyKey);}
// Internal worker capability, never mounted as a public endpoint. Called only
// after the authenticated Commerce capture response requests a late refund.
export async function rawRefundExpiredCommercePayment(id:string){
  const [p]=await database.select().from(paymentsTable).where(eq(paymentsTable.id,id)).limit(1);
  if(!p||!isCommerceOrder(p)||!p.userId)throw new ServiceError('invalid_commerce_refund',409);
  const [user]=await database.select().from(usersTable).where(eq(usersTable.id,p.userId)).limit(1);
  if(!user)throw new ServiceError('payment_owner_missing',409);
  return requestRefund(id,{amount:p.amount,reason:'Late capture after Commerce reservation expired'}, {application:p.application as AuthContext['application'],user,scopes:[],clientId:'payment-worker',sessionId:null},'commerce-late:'+id,true);
}
async function requestRefund(
  id: string,
  input: RefundPaymentInput,
  auth: AuthContext,
  idempotencyKey: string,
  system = false,
) {
  if (!system && !canManageAll(auth)&&!input.commerceReturnId) throw new ServiceError("refund_forbidden", 403);
  if (!idempotencyKey || idempotencyKey.length > 255)
    throw new ServiceError("invalid_idempotency_key", 400);
  let merchantAuthorized=false;
  if(!system&&input.commerceReturnId){
    const [p]=await database.select().from(paymentsTable).where(eq(paymentsTable.id,id)).limit(1);
    if(!p||!isCommerceOrder(p))throw new ServiceError('refund_forbidden',403);
    const quote=await authoritativeRefund(id,input.commerceReturnId,auth);
    if((input.amount!==undefined&&input.amount!==quote.amountMinor)||p.currency!==quote.currency)throw new ServiceError('refund_amount_mismatch',422);
    input={...input,amount:quote.amountMinor};merchantAuthorized=true;idempotencyKey='commerce-return:'+quote.returnId;
  }
  const reservation = await database.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.id, id))
      .for("update");
    if (!payment) throw new ServiceError("payment_not_found", 404);
    if (payment.application !== auth.application&&!merchantAuthorized)
      throw new ServiceError("refund_forbidden", 403);
    const [existing] = await tx
      .select()
      .from(refundsTable)
      .where(
        and(
          eq(refundsTable.paymentId, id),
          eq(refundsTable.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (existing) {
      if (input.amount !== undefined && input.amount !== existing.amount)
        throw new ServiceError("idempotency_conflict", 409);
      return { payment, refund: existing, reused: true };
    }
    if (
      !payment.providerPaymentId ||
      !["succeeded", "partially_refunded"].includes(payment.status)
    )
      throw new ServiceError("payment_not_refundable", 409);
    const [reserved] = await tx
      .select({ amount: sql<number>`coalesce(sum(${refundsTable.amount}),0)` })
      .from(refundsTable)
      .where(
        and(
          eq(refundsTable.paymentId, id),
          inArray(refundsTable.status, ["pending", "processing"]),
        ),
      );
    const available =
      payment.amountCaptured -
      payment.amountRefunded -
      Number(reserved?.amount ?? 0);
    const amount = input.amount ?? available;
    if (amount <= 0 || amount > available)
      throw new ServiceError("refund_amount_exceeds_payment", 422);
    const refundId = crypto.randomUUID();
    const createdAt = new Date();
    const [refund] = await tx
      .insert(refundsTable)
      .values({
        id: refundId,
        paymentId: id,
        requestedByUserId: auth.user.id,
        idempotencyKey,
        amount,
        currency: payment.currency,
        reason: input.reason,
        metadata: input.commerceReturnId ? {commerceReturnId:input.commerceReturnId} : {},
        createdAt,
        providerRefundId: refundRequestReference(
          payment.provider as ProviderCode,
          refundId,
          createdAt,
        ),
      })
      .returning();
    if (!refund) throw new ServiceError("refund_create_failed", 409);
    return { payment, refund, reused: false };
  });
  if (reservation.reused) return reservation.refund;
  const { payment, refund } = reservation;

  try {
    const [charge] = await database
      .select()
      .from(paymentTransactionsTable)
      .where(
        and(
          eq(paymentTransactionsTable.paymentId, id),
          eq(paymentTransactionsTable.type, "charge"),
          eq(paymentTransactionsTable.status, "succeeded"),
        ),
      )
      .orderBy(desc(paymentTransactionsTable.createdAt))
      .limit(1);
    const provider = await refundProviderPayment(
      payment.provider as ProviderCode,
      payment.providerPaymentId!,
      refund.amount,
      payment.id,
      {
        refundId: refund.id,
        providerTransactionId: charge?.providerTransactionId ?? undefined,
        currency: payment.currency,
        full: refund.amount === payment.amountCaptured,
        createdAt: refund.createdAt,
        metadata: payment.metadata as Record<string, unknown>,
      },
    );
    return await rawSettleRefund(
      refund.id,
      provider.status === "succeeded"
        ? "succeeded"
        : ["failed", "canceled"].includes(provider.status)
          ? "failed"
          : "processing",
      provider.id,
      provider.raw,
    );
  } catch (error) {
    await database
      .update(refundsTable)
      // Timeout may have happened AFTER the provider accepted the refund. Retain
      // the reservation for reconciliation; do not allow another refund to spend it.
      .set({
        status: "processing",
        failureMessage: "refund_outcome_unknown",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(refundsTable.id, refund.id),
          inArray(refundsTable.status, ["pending", "processing"]),
        ),
      );
    throw error instanceof ServiceError
      ? error
      : new ServiceError("refund_outcome_unknown", 502);
  }
}

export async function rawSettleRefund(
  id: string,
  status: "succeeded" | "processing" | "failed",
  providerId?: string,
  outcome?: Record<string, unknown>,
) {
  return database.transaction(async (tx) => {
    const [snapshot] = await tx
      .select()
      .from(refundsTable)
      .where(eq(refundsTable.id, id))
      .limit(1);
    if (!snapshot) throw new ServiceError("refund_not_found", 404);
    // Consistent lock order with reservation: payment, then refund.
    const [payment] = await tx
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.id, snapshot.paymentId))
      .for("update");
    const [refund] = await tx
      .select()
      .from(refundsTable)
      .where(eq(refundsTable.id, id))
      .for("update");
    if (!payment || !refund) throw new ServiceError("refund_not_found", 404);
    if (["succeeded", "failed", "cancelled"].includes(refund.status))
      return refund;
    if (status === "succeeded") {
      const total = payment.amountRefunded + refund.amount;
      if (total > payment.amountCaptured)
        throw new ServiceError("refund_amount_exceeds_payment", 409);
      await rawEnqueueCommerce(tx,payment,'refund',total,{returnId:typeof (refund.metadata as Record<string,unknown>)?.commerceReturnId==='string'?(refund.metadata as Record<string,string>).commerceReturnId:undefined,refundId:refund.id,refundMinor:refund.amount});
      await tx
        .update(paymentsTable)
        .set({
          amountRefunded: total,
          status:
            total === payment.amountCaptured
              ? "refunded"
              : "partially_refunded",
          updatedAt: new Date(),
        })
        .where(eq(paymentsTable.id, payment.id));
    }
    const [updated] = await tx
      .update(refundsTable)
      .set({
        status,
        providerRefundId: providerId ?? refund.providerRefundId,
        metadata: outcome ? {...refund.metadata as Record<string,unknown>, providerOutcome: outcome } : refund.metadata,
        processedAt: status === "processing" ? null : new Date(),
        failureMessage: status === "failed" ? "provider_refund_failed" : null,
        updatedAt: new Date(),
      })
      .where(eq(refundsTable.id, id))
      .returning();
    if(!updated)throw new ServiceError('refund_update_failed',409);
    await tx
      .insert(paymentHistoryTable)
      .values({
        paymentId: payment.id,
        refundId: id,
        eventType: `refund.${status}`,
        providerReference: providerId,
      });
    return updated;
  });
}

export interface ProviderEventInput {
  provider: ProviderCode;
  providerEventId: string;
  eventType: string;
  providerPaymentId: string;
  providerTransactionId?: string;
  status: NormalizedProviderStatus;
  amount?: number;
  currency?: string;
  payload: Record<string, unknown>;
}

export async function rawProcessProviderEvent(input: ProviderEventInput) {
  return database.transaction(async (transaction) => {
    await transaction
      .insert(webhookEventsTable)
      .values({
        provider: input.provider,
        providerEventId: input.providerEventId,
        eventType: input.eventType,
        payload: input.payload,
      })
      .onConflictDoNothing();
    const [event] = await transaction
      .select()
      .from(webhookEventsTable)
      .where(
        and(
          eq(webhookEventsTable.provider, input.provider),
          eq(webhookEventsTable.providerEventId, input.providerEventId),
        ),
      )
      .for("update");
    if (!event) throw new ServiceError("webhook_create_failed", 409);
    if (event.status === "processed") return { duplicate: true };
    const [payment] = await transaction
      .select()
      .from(paymentsTable)
      .where(
        and(
          eq(paymentsTable.provider, input.provider),
          eq(paymentsTable.providerPaymentId, input.providerPaymentId),
        ),
      )
      .limit(1);
    if (!payment) throw new ServiceError("payment_not_found", 404);

    if (input.currency && payment.currency !== input.currency)
      throw new ServiceError("provider_currency_mismatch", 409);

    const updated = await applyProviderStatus(
      payment,
      input.status,
      input.providerTransactionId,
      input.amount,
      input.eventType,
      input.payload,
      transaction,
    );
    await transaction
      .update(webhookEventsTable)
      .set({
        status: "processed",
        processedAt: new Date(),
        attemptCount: sql`${webhookEventsTable.attemptCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(webhookEventsTable.id, event.id));
    return { duplicate: false, payment: updated };
    // On any failure the receipt AND business mutation roll back together. The
    // provider's next retry can process it, rather than being ignored as duplicate.
  });
}
