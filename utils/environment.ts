import dotenv from "dotenv";

dotenv.config({
  path: ".env.local",
  override: false,
  debug: false,
  quiet: true,
});

export const nodeEnv = process.env.NODE_ENV;
export const isProduction = nodeEnv === "production";
export const port = process.env.NITRO_PUBLIC_PORT;

export const authUrl = process.env.NITRO_PUBLIC_AUTH_URL;
export const databaseUrl = process.env.DATABASE_URL;
export const pgPoolMax = process.env.PG_POOL_MAX;
export const oauthClientId = process.env.NITRO_OAUTH_CLIENT_ID;
export const oauthClientSecret = process.env.NITRO_OAUTH_CLIENT_SECRET;

export const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
export const stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
export const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export const momoApiUrl = process.env.MOMO_API_URL;
export const momoPartnerCode = process.env.MOMO_PARTNER_CODE;
export const momoAccessKey = process.env.MOMO_ACCESS_KEY;
export const momoSecretKey = process.env.MOMO_SECRET_KEY;
export const momoPartnerName = process.env.MOMO_PARTNER_NAME;
export const momoStoreId = process.env.MOMO_STORE_ID;

export const zaloPayApiUrl = process.env.ZALOPAY_API_URL;
export const zaloPayAppId = process.env.ZALOPAY_APP_ID;
export const zaloPayKey1 = process.env.ZALOPAY_KEY1;
export const zaloPayKey2 = process.env.ZALOPAY_KEY2;

export const vnPayPaymentUrl = process.env.VNPAY_PAYMENT_URL;
export const vnPayApiUrl = process.env.VNPAY_API_URL;
export const vnPayTmnCode = process.env.VNPAY_TMN_CODE;
export const vnPayHashSecret = process.env.VNPAY_HASH_SECRET;
export const vnPayLocale = process.env.VNPAY_LOCALE ?? "vn";


// Telemetry is Vercel-only; do not opt into a separately configured collector.
export const vercelTelemetryEnabled = process.env.VERCEL === "1" &&
  ![process.env.OTEL_EXPORTER_OTLP_ENDPOINT, process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    process.env.OTEL_EXPORTER_OTLP_HEADERS, process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS].some(Boolean)
export const vercelDeployment = process.env.VERCEL === "1"
export const cronSecret = process.env.CRON_SECRET ?? ""

// Optional operator-owned OAuth client aliases; validated against existing namespaces.
