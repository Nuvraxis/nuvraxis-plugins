import "@nuvui/react/styles.css";
import "@/styles/globals.scss";

import type { Metadata } from "next";
import { headers } from "next/headers";
import { NonceProvider } from "@/components/nonce-provider/nonce-provider";

export const metadata: Metadata = {
  title: { default: "__APP__", template: "%s · __APP__" },
};

// Every response carries a fresh CSP nonce, so pages render per request instead of from a
// prerendered shell. Data caching with "use cache" still works.
export const instant = false;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const nonce = (await headers()).get("x-nonce") ?? "";

  return (
    <html lang="en" data-theme="system" data-density="default">
      <body>
        <NonceProvider nonce={nonce}>{children}</NonceProvider>
      </body>
    </html>
  );
}
