import { Hono } from "hono";
import { actHealth, actStatus } from "@/controllers/health";
import { serviceResourceMetadata } from "@/lib/auth/verification";

export const sharedRoutes = new Hono();

sharedRoutes.get("/health", actHealth);
sharedRoutes.get("/", actStatus);

sharedRoutes.get("/.well-known/oauth-protected-resource", serviceResourceMetadata);
