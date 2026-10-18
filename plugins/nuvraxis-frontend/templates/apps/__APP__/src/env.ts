import "server-only";
import * as v from "valibot";

// Runtime configuration, read on the server only. Values come from the chart's ConfigMap and
// the app's Secret. NEXT_PUBLIC_* values are build-time constants and don't belong here.
const ServerEnv = v.object({
  NODE_ENV: v.optional(v.picklist(["development", "production", "test"]), "production"),
  // Add the app's own variables here, for example:
  // API_BASE_URL: v.pipe(v.string(), v.url()),
  // DATABASE_URL: v.pipe(v.string(), v.minLength(1)),
});

export type ServerEnv = v.InferOutput<typeof ServerEnv>;

let parsed: ServerEnv | undefined;

// Parsed on first use, not at import, so `next build` never needs runtime secrets.
export function env(): ServerEnv {
  parsed ??= v.parse(ServerEnv, process.env);
  return parsed;
}
