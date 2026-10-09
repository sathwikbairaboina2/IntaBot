import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import type { AccountView } from "@/lib/api";
import { getAccounts, getMe, getNavCounts } from "@/lib/queries";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect("/login");

  // The shell still renders if /accounts fails; the page under it shows the error.
  const accounts: AccountView[] = await getAccounts().catch(() => []);
  const counts = await getNavCounts(accounts);

  return (
    <AppShell email={me.email} counts={counts} dryRunAccounts={accounts.filter((a) => a.dryRun).length}>
      {children}
    </AppShell>
  );
}
