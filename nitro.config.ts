import { defineConfig } from "nitro";
import { port } from "./utils/environment";

export default defineConfig({
  // Preserve standard Response cloning/status through middleware and compression.
  // Nitro's current srvx FastResponse loses status when a Response is used as init.
  features: { fastResponse: false },
  // Select native Vercel Queue delivery in both dev and production.
  preset: "vercel",
  buildDir: ".nitro",
  serverDir: "./app",
  scanDirs: ["."],
  ignore: ["routes/**"],
  // Explicit registration keeps global middleware active outside Nitro's default directory.
  handlers: [
    { route: "/**", middleware: true, handler: "./middlewares/background.ts" },
    { route: "/**", middleware: true, handler: "./middlewares/00.http.ts" },
    { route: "/**", middleware: true, handler: "./middlewares/01.errors.ts" },
  ],
  errorHandler: "./app/error.ts",
  alias: { "@": import.meta.dirname },
  devServer: { port: Number(port) || 5055, hostname: "0.0.0.0" },
  experimental: { tasks: true },
  // Vercel Hobby supports daily cron schedules.
  scheduledTasks: { "0 0 * * *": ["background:recover", "background:maintenance"] },
  vercel: {
    entryFormat: "web",
    functions: { runtime: "nodejs24.x", maxDuration: 300 },
    queues: { triggers: [{ topic: "payment-jobs", retryAfterSeconds: 60 }] },
  },
});
