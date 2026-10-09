"use client";

import { ErrorView } from "@/components/ui";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorView digest={error.digest} reset={reset} />;
}
