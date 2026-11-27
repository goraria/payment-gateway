export { rateLimit } from "@/database/rate-limit";
import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm/_relations";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const paymentStatus = pgEnum("payment_status", [
  "pending",
  "requires_action",
  "authorized",
  "processing",
  "succeeded",
  "failed",
  "cancelled",
  "partially_refunded",
  "refunded",
]);

export const transactionType = pgEnum("transaction_type", [
  "authorization",
  "capture",
  "charge",
  "void",
  "refund",
  "adjustment",
]);

export const transactionStatus = pgEnum("transaction_status", [
  "pending",
  "processing",
  "succeeded",
  "failed",
  "cancelled",
]);

export const refundStatus = pgEnum("refund_status", [
  "pending",
  "processing",
  "succeeded",
  "failed",
  "cancelled",
]);

export const paymentMethodType = pgEnum("payment_method_type", [
  "card",
  "bank_account",
  "wallet",
  "qr",
  "cash",
  "other",
]);

export const webhookStatus = pgEnum("webhook_status", [
  "pending",
  "processing",
  "processed",
  "failed",
  "ignored",
]);

export const reconciliationStatus = pgEnum("reconciliation_status", [
  "pending",
  "matched",
  "mismatched",
  "resolved",
]);

export const usersTable = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalUserId: text("external_user_id").notNull().unique(),
    name: text("name").notNull().default(""),
    username: varchar("username", { length: 32 }).unique(),
    role: varchar("role", { length: 32 }).notNull().default("user"),
    email: varchar("email", { length: 255 }).notNull().unique(),
    image: text("image"),
    metadata: jsonb("metadata").notNull().default(sql.raw("'{}'::jsonb")),
    lastSeenAt: timestamp("last_seen_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [index("users_last_seen_at_idx").on(table.lastSeenAt)],
);

export const paymentProvidersTable = pgTable(
  "payment_providers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    adapter: varchar("adapter", { length: 128 }).notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    configuration: jsonb("configuration")
      .notNull()
      .default(sql.raw("'{}'::jsonb")),
    secretReference: text("secret_reference"),
    metadata: jsonb("metadata").notNull().default(sql.raw("'{}'::jsonb")),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("payment_providers_code_key").on(table.code)],
);

export const paymentCustomersTable = pgTable(
  "payment_customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 64 }).notNull(),
    providerCustomerId: text("provider_customer_id").notNull(),
    metadata: jsonb("metadata").notNull().default(sql.raw("'{}'::jsonb")),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payment_customers_user_provider_key").on(
      table.userId,
      table.provider,
    ),
    uniqueIndex("payment_customers_provider_customer_key").on(
      table.provider,
      table.providerCustomerId,
    ),
  ],
);

export const paymentMethodsTable = pgTable(
  "payment_methods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => paymentCustomersTable.id, {
      onDelete: "set null",
    }),
    provider: varchar("provider", { length: 64 }).notNull(),
    providerPaymentMethodId: text("provider_payment_method_id").notNull(),
    type: paymentMethodType("type").notNull(),
    brand: varchar("brand", { length: 32 }),
    lastFour: varchar("last_four", { length: 4 }),
    expiryMonth: integer("expiry_month"),
    expiryYear: integer("expiry_year"),
    isDefault: boolean("is_default").notNull().default(false),
    billingDetails: jsonb("billing_details")
      .notNull()
      .default(sql.raw("'{}'::jsonb")),
    metadata: jsonb("metadata").notNull().default(sql.raw("'{}'::jsonb")),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { mode: "date" }),
  },
  (table) => [
    uniqueIndex("payment_methods_provider_reference_key").on(
      table.provider,
      table.providerPaymentMethodId,
    ),
    index("payment_methods_user_default_idx").on(table.userId, table.isDefault),
    index("payment_methods_customer_id_idx").on(table.customerId),
  ],
);

export const paymentsTable = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    paymentMethodId: uuid("payment_method_id").references(
      () => paymentMethodsTable.id,
      { onDelete: "set null" },
    ),
    application: varchar("application", { length: 64 }).notNull(),
    referenceType: varchar("reference_type", { length: 64 }).notNull(),
    referenceId: text("reference_id").notNull(),
    provider: varchar("provider", { length: 64 }).notNull(),
    providerPaymentId: text("provider_payment_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    status: paymentStatus("status").notNull().default("pending"),
    amount: bigint("amount", { mode: "number" }).notNull(),
    amountCaptured: bigint("amount_captured", { mode: "number" })
      .notNull()
      .default(0),
    amountRefunded: bigint("amount_refunded", { mode: "number" })
      .notNull()
      .default(0),
    currency: varchar("currency", { length: 3 }).notNull(),
    description: text("description"),
    failureCode: varchar("failure_code", { length: 128 }),
    failureMessage: text("failure_message"),
    metadata: jsonb("metadata").notNull().default(sql.raw("'{}'::jsonb")),
    authorizedAt: timestamp("authorized_at", { mode: "date" }),
    capturedAt: timestamp("captured_at", { mode: "date" }),
    cancelledAt: timestamp("cancelled_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payments_idempotency_key").on(table.idempotencyKey),
    uniqueIndex("payments_provider_payment_key").on(
      table.provider,
      table.providerPaymentId,
    ),
    index("payments_user_created_at_idx").on(table.userId, table.createdAt),
    index("payments_reference_idx").on(
      table.application,
      table.referenceType,
      table.referenceId,
    ),
    index("payments_status_created_at_idx").on(table.status, table.createdAt),
    uniqueIndex("commerce_payment_order_unique").on(table.referenceId).where(
      sql`${table.application} IN ('marketplace','restaurant') AND ${table.referenceType} = 'order'`,
    ),
    check("payments_amount_check", sql`${table.amount} >= 0`),
    check("payments_amount_captured_check", sql`${table.amountCaptured} >= 0`),
    check("payments_amount_refunded_check", sql`${table.amountRefunded} >= 0`),
  ],
);

// Transactional delivery to Commerce. No access token or provider payload persists.
export const commerceDeliveryTable = pgTable('commerce_delivery',{
  id:text('id').primaryKey(),paymentId:uuid('payment_id').notNull().references(()=>paymentsTable.id),
  orderId:uuid('order_id').notNull(),kind:text('kind').notNull(),
  amountMinor:bigint('amount_minor',{mode:'number'}).notNull(),currency:text('currency').notNull(),
  returnId:uuid('return_id'),refundId:uuid('refund_id'),refundMinor:bigint('refund_minor',{mode:'number'}),
  attempts:integer('attempts').notNull().default(0),availableAt:timestamp('available_at',{withTimezone:true}).notNull().defaultNow(),
  leaseToken:uuid('lease_token'),leaseUntil:timestamp('lease_until',{withTimezone:true}),deliveredAt:timestamp('delivered_at',{withTimezone:true}),
}, (table) => [
  check("commerce_delivery_amount_minor_check", sql`${table.amountMinor} >= 0`),
  check("commerce_delivery_kind_check", sql`${table.kind} IN ('capture','failed','refund')`),
  index("commerce_delivery_pending_idx").on(table.availableAt, table.id)
    .where(sql`${table.deliveredAt} IS NULL`),
]);

export const paymentTransactionsTable = pgTable(
  "payment_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => paymentsTable.id, { onDelete: "cascade" }),
    providerTransactionId: text("provider_transaction_id"),
    type: transactionType("type").notNull(),
    status: transactionStatus("status").notNull().default("pending"),
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    failureCode: varchar("failure_code", { length: 128 }),
    failureMessage: text("failure_message"),
    metadata: jsonb("metadata").notNull().default(sql.raw("'{}'::jsonb")),
    processedAt: timestamp("processed_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payment_transactions_provider_reference_key").on(
      table.providerTransactionId,
    ),
    index("payment_transactions_payment_created_at_idx").on(
      table.paymentId,
      table.createdAt,
    ),
    index("payment_transactions_status_created_at_idx").on(
      table.status,
      table.createdAt,
    ),
    check("payment_transactions_amount_check", sql`${table.amount} >= 0`),
  ],
);

export const refundsTable = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => paymentsTable.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id").references(
      () => paymentTransactionsTable.id,
      { onDelete: "set null" },
    ),
    requestedByUserId: uuid("requested_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    providerRefundId: text("provider_refund_id"),
    idempotencyKey: text("idempotency_key"),
    status: refundStatus("status").notNull().default("pending"),
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    reason: text("reason"),
    failureMessage: text("failure_message"),
    metadata: jsonb("metadata").notNull().default(sql.raw("'{}'::jsonb")),
    processedAt: timestamp("processed_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("refunds_provider_reference_key").on(table.providerRefundId),
    uniqueIndex("refunds_payment_idempotency_key").on(table.paymentId, table.idempotencyKey),
    index("refunds_payment_created_at_idx").on(
      table.paymentId,
      table.createdAt,
    ),
    index("refunds_status_created_at_idx").on(table.status, table.createdAt),
    check("refunds_amount_check", sql`${table.amount} > 0`),
  ],
);

export const webhookEventsTable = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: varchar("provider", { length: 64 }).notNull(),
    providerEventId: text("provider_event_id").notNull(),
    eventType: varchar("event_type", { length: 128 }).notNull(),
    status: webhookStatus("status").notNull().default("pending"),
    payload: jsonb("payload").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    error: text("error"),
    receivedAt: timestamp("received_at", { mode: "date" })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("webhook_events_provider_event_key").on(
      table.provider,
      table.providerEventId,
    ),
    index("webhook_events_status_received_at_idx").on(
      table.status,
      table.receivedAt,
    ),
  ],
);

export const paymentHistoryTable = pgTable(
  "payment_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => paymentsTable.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id").references(
      () => paymentTransactionsTable.id,
      { onDelete: "set null" },
    ),
    refundId: uuid("refund_id").references(() => refundsTable.id, {
      onDelete: "set null",
    }),
    eventType: varchar("event_type", { length: 128 }).notNull(),
    fromStatus: varchar("from_status", { length: 64 }),
    toStatus: varchar("to_status", { length: 64 }),
    providerReference: text("provider_reference"),
    data: jsonb("data").notNull().default(sql.raw("'{}'::jsonb")),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("payment_history_payment_created_at_idx").on(
      table.paymentId,
      table.createdAt,
    ),
  ],
);

export const paymentReconciliationsTable = pgTable(
  "payment_reconciliations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: varchar("provider", { length: 64 }).notNull(),
    providerReference: text("provider_reference").notNull(),
    status: reconciliationStatus("status").notNull().default("pending"),
    currency: varchar("currency", { length: 3 }).notNull(),
    expectedAmount: bigint("expected_amount", { mode: "number" }).notNull(),
    actualAmount: bigint("actual_amount", { mode: "number" }).notNull(),
    differenceAmount: bigint("difference_amount", { mode: "number" })
      .notNull()
      .default(0),
    periodStartedAt: timestamp("period_started_at", { mode: "date" }).notNull(),
    periodEndedAt: timestamp("period_ended_at", { mode: "date" }).notNull(),
    reconciledAt: timestamp("reconciled_at", { mode: "date" }),
    metadata: jsonb("metadata").notNull().default(sql.raw("'{}'::jsonb")),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payment_reconciliations_provider_reference_key").on(
      table.provider,
      table.providerReference,
    ),
    index("payment_reconciliations_status_period_idx").on(
      table.status,
      table.periodStartedAt,
      table.periodEndedAt,
    ),
  ],
);

export const webhookAttemptsTable = pgTable(
  "webhook_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    webhookEventId: uuid("webhook_event_id")
      .notNull()
      .references(() => webhookEventsTable.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    status: webhookStatus("status").notNull(),
    responseStatus: integer("response_status"),
    error: text("error"),
    scheduledAt: timestamp("scheduled_at", { mode: "date" }).notNull(),
    processedAt: timestamp("processed_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("webhook_attempts_event_number_key").on(
      table.webhookEventId,
      table.attemptNumber,
    ),
  ],
);

export const usersRelations = relations(usersTable, ({ many }) => ({
  customers: many(paymentCustomersTable),
  methods: many(paymentMethodsTable),
  payments: many(paymentsTable),
  requestedRefunds: many(refundsTable),
}));

export const paymentsRelations = relations(paymentsTable, ({ many, one }) => ({
  user: one(usersTable, {
    fields: [paymentsTable.userId],
    references: [usersTable.id],
  }),
  paymentMethod: one(paymentMethodsTable, {
    fields: [paymentsTable.paymentMethodId],
    references: [paymentMethodsTable.id],
  }),
  transactions: many(paymentTransactionsTable),
  refunds: many(refundsTable),
}));

export type User = typeof usersTable.$inferSelect;
export type PaymentCustomer = typeof paymentCustomersTable.$inferSelect;
export type PaymentMethod = typeof paymentMethodsTable.$inferSelect;
export type Payment = typeof paymentsTable.$inferSelect;
export type PaymentTransaction = typeof paymentTransactionsTable.$inferSelect;
export type Refund = typeof refundsTable.$inferSelect;
export type WebhookEvent = typeof webhookEventsTable.$inferSelect;
export type PaymentProvider = typeof paymentProvidersTable.$inferSelect;
export type PaymentHistory = typeof paymentHistoryTable.$inferSelect;
export type PaymentReconciliation =
  typeof paymentReconciliationsTable.$inferSelect;
export type WebhookAttempt = typeof webhookAttemptsTable.$inferSelect;
