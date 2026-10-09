"use client";

import { ErrorView } from "@/components/ui";

// Catches failures above the dashboard shell, e.g. /auth/me while the API is down.
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="center-page">
      <ErrorView digest={error.digest} reset={reset} />
    </main>
  );
}
