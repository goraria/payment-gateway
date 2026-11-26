import { Hono } from "hono";
import { actListProviderCapabilities } from "@/controllers/capabilities";
import {
  actCancelPayment,
  actCreatePayment,
  actGetPayment,
  actListPayments,
  actMomoWebhook,
  actPaymentReturn,
  actQueryPayment,
  actRefundPayment,
  actStripeWebhook,
  actVnPayWebhook,
  actZaloPayWebhook,
} from "@/controllers/payment";
import { requireAuth } from "@/middlewares/auth";

export const paymentRoutes = new Hono();

paymentRoutes.post("/webhook/momo", actMomoWebhook);
paymentRoutes.post("/webhook/stripe", actStripeWebhook);
paymentRoutes.get("/webhook/vnpay", actVnPayWebhook);
paymentRoutes.post("/webhook/zalopay", actZaloPayWebhook);
paymentRoutes.get("/return/:provider", actPaymentReturn);
paymentRoutes.get("/", requireAuth("read"), actListPayments);
paymentRoutes.post("/intent", requireAuth("write"), actCreatePayment);
paymentRoutes.get("/provider", requireAuth("read"), actListProviderCapabilities);
paymentRoutes.post("/:id/cancel", requireAuth("write"), actCancelPayment);
paymentRoutes.post("/:id/query", requireAuth("write"), actQueryPayment);
paymentRoutes.post("/:id/refund", requireAuth("write"), actRefundPayment);
paymentRoutes.get("/:id", requireAuth("read"), actGetPayment);
