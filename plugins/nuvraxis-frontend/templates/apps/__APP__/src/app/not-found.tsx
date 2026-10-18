import { Button } from "@nuvui/react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page">
      <h1 className="page__title">Page not found</h1>
      <Button asChild intent="secondary">
        <Link href="/">Back to the start</Link>
      </Button>
    </main>
  );
}
