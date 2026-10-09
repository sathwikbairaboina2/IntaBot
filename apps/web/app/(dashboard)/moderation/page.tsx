import type { Metadata } from "next";
import { AutoRefresh } from "@/components/auto-refresh";
import { NeedAccount } from "@/components/ui";
import type { CommentView } from "@/lib/api";
import { getAccounts, getModeration } from "@/lib/queries";
import { initials, relativeTime } from "@/lib/view";
import { ModerationView, type CommentItem, type ModerationGroup } from "./moderation-view";

export const metadata: Metadata = { title: "Moderation" };

// Moderation happens asynchronously. The server answer is cached for 5 s and
// AutoRefresh re-requests it every 5 s while the tab is visible. SSE replaces
// this in Phase 5.
export const revalidate = 5;

export default async function ModerationPage() {
  const accounts = await getAccounts();
  if (accounts.length === 0) return <NeedAccount />;

  const now = new Date();
  const item = (c: CommentView): CommentItem => ({ ...c, initials: initials(c.fromUsername), ago: relativeTime(c.createdAt, now) });
  const groups: ModerationGroup[] = await Promise.all(
    accounts.map(async (account) => {
      const moderation = await getModeration(account.id);
      return {
        account: { id: account.id, name: account.name, username: account.username, moderationPaused: account.moderationPaused },
        escalated: moderation.escalated.map(item),
        autoReplies: moderation.recentAutoReplies.map(item),
      };
    }),
  );

  return (
    <>
      <AutoRefresh />
      <ModerationView groups={groups} />
    </>
  );
}
