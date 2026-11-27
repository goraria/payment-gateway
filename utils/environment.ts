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
export const serviceUrl = process.env.NITRO_PUBLIC_SERVICE_URL;

export const authUrl = process.env.NITRO_PUBLIC_AUTH_URL;
export const databaseUrl = process.env.DATABASE_URL;
export const pgPoolMax = process.env.PG_POOL_MAX;
export const oauthClientId = process.env.NITRO_OAUTH_CLIENT_ID;
export const oauthClientSecret = process.env.NITRO_OAUTH_CLIENT_SECRET;

export const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
export const stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
export const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export const momoEnabled = process.env.MOMO_ENABLED === "true";
export const momoApiUrl = process.env.MOMO_API_URL;
export const momoPartnerCode = process.env.MOMO_PARTNER_CODE;
export const momoAccessKey = process.env.MOMO_ACCESS_KEY;
export const momoSecretKey = process.env.MOMO_SECRET_KEY;
export const momoPartnerName = process.env.MOMO_PARTNER_NAME;
export const momoStoreId = process.env.MOMO_STORE_ID;
export const momoRedirectUrl = process.env.MOMO_REDIRECT_URL;
export const momoIpnUrl = process.env.MOMO_IPN_URL;
export const momoEndpoint = process.env.MOMO_ENDPOINT;
export const momoSignatureKey = process.env.MOMO_SIGNATURE_KEY;
export const momoPaymentCode = process.env.MOMO_PAYMENT_CODE;

export const zaloPayApiUrl = process.env.ZALOPAY_API_URL;

export const zaloPayMerchantEnabled = process.env.ZALOPAY_MERCHANT_ENABLED === "true";
export const zaloPayMerchantAppId = process.env.ZALOPAY_MERCHANT_APP_ID;
export const zaloPayMerchantKey1 = process.env.ZALOPAY_MERCHANT_KEY1;
export const zaloPayMerchantKey2 = process.env.ZALOPAY_MERCHANT_KEY2;
export const zaloPayMerchantEndpoint = process.env.ZALOPAY_MERCHANT_ENDPOINT;
export const zaloPayMerchantGatewayEndpoint = process.env.ZALOPAY_MERCHANT_GATEWAY_ENDPOINT;
export const zaloPayMerchantCallbackUrl = process.env.ZALOPAY_MERCHANT_CALLBACK_URL;
export const zaloPayMerchantRedirectUrl = process.env.ZALOPAY_MERCHANT_REDIRECT_URL;

export const vnPayPaymentUrl = process.env.VNPAY_PAYMENT_URL;
export const vnPayApiUrl = process.env.VNPAY_API_URL;
export const vnPayTmnCode = process.env.VNPAY_TMN_CODE;
export const vnPayHashSecret = process.env.VNPAY_HASH_SECRET;
export const vnPayLocale = process.env.VNPAY_LOCALE ?? "vn";
export const vnPayReturnUrl = process.env.VNPAY_RETURN_URL;
export const vnPayIpnUrl = process.env.VNPAY_IPN_URL;
export const vnPayUrl = process.env.VNPAY_URL;

export const payPalEnabled = process.env.PAYPAL_ENABLED === "true";
export const payPalClientId = process.env.PAYPAL_CLIENT_ID;
export const payPalClientSecret = process.env.PAYPAL_CLIENT_SECRET;
export const payPalMode = process.env.PAYPAL_MODE;
export const payPalEnvironment = process.env.PAYPAL_ENVIRONMENT;


// Telemetry is Vercel-only; do not opt into a separately configured collector.
export const vercelTelemetryEnabled = process.env.VERCEL === "1" &&
  ![process.env.OTEL_EXPORTER_OTLP_ENDPOINT, process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    process.env.OTEL_EXPORTER_OTLP_HEADERS, process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS].some(Boolean)
export const vercelDeployment = process.env.VERCEL === "1"
export const cronSecret = process.env.CRON_SECRET ?? ""
