# Observability

## `src/instrumentation.ts`

<!-- template: apps/__APP__/src/instrumentation.ts -->
```ts
import { registerOTel } from "@vercel/otel";
import type { Instrumentation } from "next";

export function register() {
  // The exporter is configured at runtime by the standard OTEL_EXPORTER_OTLP_* variables.
  registerOTel({ serviceName: process.env.OTEL_SERVICE_NAME ?? "__APP__" });
}

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  // One JSON line per unhandled error. The digest matches what error.tsx shows the user.
  console.error(
    JSON.stringify({
      level: "error",
      msg: error instanceof Error ? error.message : String(error),
      digest: (error as { digest?: string }).digest,
      method: request.method,
      path: request.path,
      routeType: context.routeType,
      routePath: context.routePath,
    }),
  );
};
```

- `register()` runs once per server process, before any request. No flag is needed in Next 16.
- `onRequestError` receives errors from rendering, route handlers, Server Actions and proxy. It's the place to forward to Sentry or similar; don't sprinkle `try/catch` + log in components.
- Exporter configuration comes from the standard env vars at runtime, set in the chart's ConfigMap: `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production`. Without an endpoint, spans go nowhere and cost almost nothing.

## Logs

- Log JSON to stdout, one object per line. No log files: the root filesystem is read-only.
- Never log request bodies, cookies, `authorization` headers or env values.
- The `error.digest` shown to users in `error.tsx` matches the server log line; that's how support finds it.

## Metrics

Next doesn't expose Prometheus metrics. If you need them, export OTel metrics through the same collector rather than adding a `/metrics` route to the app.

## Health

`/api/health` answers `{"status":"ok"}` with 200 and touches nothing else. It is a liveness and readiness signal for "the Node process is serving". Dependency health belongs in your alerting, not in the probe, or one slow database restarts every pod at once.
