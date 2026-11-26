import { z } from "zod"

export const providerSchema = z.enum(["stripe", "zalopay", "momo", "vnpay"])

export const createPaymentSchema = z.object({
  application: z.string().trim().min(1).max(64),
  referenceType: z.string().trim().min(1).max(64),
  referenceId: z.string().trim().min(1).max(255),
  provider: providerSchema,
  amount: z.number().int().positive().safe().optional(),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).optional(),
  description: z.string().trim().max(500).optional(),
  returnUrl: z.url().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const listPaymentSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum([
    "pending",
    "requires_action",
    "authorized",
    "processing",
    "succeeded",
    "failed",
    "cancelled",
    "partially_refunded",
    "refunded",
  ]).optional(),
  referenceType: z.string().trim().min(1).max(64).optional(),
  referenceId: z.string().trim().min(1).max(255).optional(),
})

export const refundPaymentSchema = z.object({
  commerceReturnId: z.uuid().optional(),
  amount: z.number().int().positive().safe().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
})

export type RawCreatePaymentInput = z.infer<typeof createPaymentSchema>
export type CreatePaymentInput = Omit<RawCreatePaymentInput,"amount"|"currency"> & {amount:number;currency:string}
export type ListPaymentInput = z.infer<typeof listPaymentSchema>
export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>
