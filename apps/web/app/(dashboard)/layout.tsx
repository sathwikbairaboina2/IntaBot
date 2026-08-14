import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getMe } from "@/lib/api";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect("/login");

  return (
    <main>
      <header>
        <h1>IntaBot</h1>
        <p>Signed in as {me.email}</p>
      </header>
      {children}
    </main>
  );
}
