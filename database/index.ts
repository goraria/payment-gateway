import { createDatabasePoolFactory } from "@gorth-com/structure/modules/database";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import * as schema from "@/database/schema";
import { databaseUrl, pgPoolMax } from "@/utils/environment";

const defaultPoolMax = 5;
const configuredPoolMax = Number.parseInt(pgPoolMax ?? "", 10);

if (!databaseUrl) throw new Error("DATABASE_URL is required");

const globalForDatabase = globalThis as typeof globalThis & {
  paymentGatewayPool?: Pool;
};

const pool =
  globalForDatabase.paymentGatewayPool ??
  createDatabasePoolFactory((options) => new Pool(options))({
    connectionString: databaseUrl,
    max: Number.isNaN(configuredPoolMax) ? defaultPoolMax : configuredPoolMax,
  });

if (!globalForDatabase.paymentGatewayPool) {
  attachDatabasePool(pool);
  pool.on("error", (error: unknown) => {
    console.error("[payment-gateway-pg-pool-error]", error);
  });
  globalForDatabase.paymentGatewayPool = pool;
}

export const database = drizzle({ client: pool });
export { pool, schema };
export default database;
