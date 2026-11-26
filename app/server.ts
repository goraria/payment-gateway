import { Hono } from "hono";
import { defineHandler } from "nitro";
import { routeNotFound } from "@/app/error";
import { sharedRoutes } from "@/routes/shared";
import { paymentRoutes } from "@/routes/payment";

export const router = new Hono();
router.onError((error) => { throw error });
router.notFound((context) => routeNotFound(context.req.raw));
router.route("/", sharedRoutes);
router.route("/payment", paymentRoutes);

export default defineHandler((event) => router.fetch(event.req));
