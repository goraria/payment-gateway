import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({
  envDir: false,
  cacheDir: join(tmpdir(), "gorth-service-tests", "payment-gateway", "vite"),
  resolve: { alias: { "@": import.meta.dirname } },
  test: {
    environment: "node",
    cache: false,
    fsModuleCachePath: join(
      tmpdir(),
      "gorth-service-tests",
      "payment-gateway",
      "fs",
    ),
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/*.cloud.test.ts","tests/*.sandbox.test.ts"],
    restoreMocks: true,
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
