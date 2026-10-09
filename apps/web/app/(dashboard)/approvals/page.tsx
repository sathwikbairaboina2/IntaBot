import type { Metadata } from "next";
import { AutoRefresh } from "@/components/auto-refresh";
import { NeedAccount } from "@/components/ui";
import { getAccounts, getApprovals } from "@/lib/queries";
import { slotLabel } from "@/lib/view";
import { ApprovalsView, type ApprovalGroup } from "./approvals-view";

export const metadata: Metadata = { title: "Approvals" };

// Drafting completes asynchronously. The server answer is cached for 5 s and
// AutoRefresh re-requests it every 5 s while the tab is visible. SSE replaces
// this in Phase 5.
export const revalidate = 5;

export default async function ApprovalsPage() {
  const accounts = await getAccounts();
  if (accounts.length === 0) return <NeedAccount />;

  const groups: ApprovalGroup[] = (
    await Promise.all(
      accounts.map(async (account) => ({
        account: { id: account.id, name: account.name, username: account.username, dryRun: account.dryRun },
        posts: (await getApprovals(account.id)).map((post) => ({ ...post, slot: slotLabel(post.scheduledAt) })),
      })),
    )
  ).filter((group) => group.posts.length > 0);

  return (
    <>
      <AutoRefresh />
      <ApprovalsView groups={groups} />
    </>
  );
}
