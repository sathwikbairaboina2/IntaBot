import type { Metadata } from "next";
import { API_BASE_URL, buildUrl } from "@/lib/http";
import { getAccounts } from "@/lib/queries";
import { accountStats, accountStatus, formatDate, tokenExpiry } from "@/lib/view";
import { AccountsView, type AccountRow } from "./accounts-view";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage() {
  const accounts = await getAccounts();
  const now = new Date();
  const rows: AccountRow[] = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    username: a.username,
    status: accountStatus(a.status),
    dryRun: a.dryRun,
    moderationPaused: a.moderationPaused,
    expiresOn: formatDate(a.tokenExpiresAt),
    expiry: tokenExpiry(a.tokenExpiresAt, now),
  }));
  return <AccountsView rows={rows} stats={accountStats(accounts, now)} docsUrl={buildUrl(API_BASE_URL, "/docs")} />;
}
