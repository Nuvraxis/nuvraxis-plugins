"use client";

import { Button } from "@nuvui/react";

// The error itself is logged on the server by onRequestError in instrumentation.ts. The user
// sees the digest, which support can match to that log line, and never the message.
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="page">
      <h1 className="page__title">Something went wrong</h1>
      {error.digest && <p className="page__meta">Reference: {error.digest}</p>}
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
