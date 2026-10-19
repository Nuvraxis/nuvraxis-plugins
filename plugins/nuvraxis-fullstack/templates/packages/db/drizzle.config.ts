import { existsSync } from "node:fs";
import { type Config, defineConfig } from "drizzle-kit";

// Local runs read DATABASE_URL from the repo root .env (see .env.example). CI and the cluster
// set it in the environment, which always wins.
if (!process.env.DATABASE_URL && existsSync("../../.env")) {
  process.loadEnvFile("../../.env");
}

const config: Config = defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  verbose: true,
});

export default config;
