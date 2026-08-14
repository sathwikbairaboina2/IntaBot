import { getAccounts, getApprovals } from "@/lib/api";
import { ApprovalCard } from "./approval-card";

// Drafting completes asynchronously, so the queue is re-fetched on an
// interval rather than requiring a manual reload. SSE replaces this in
// Phase 5.
export const revalidate = 5;

export default async function ApprovalsPage() {
  const accounts = await getAccounts();
  if (accounts.length === 0) return <p>Connect an account first.</p>;

  const sections = await Promise.all(
    accounts.map(async (account) => ({
      account,
      posts: await getApprovals(account.id),
    })),
  );

  const total = sections.reduce((n, s) => n + s.posts.length, 0);
  if (total === 0) return <p>Nothing waiting for approval.</p>;

  return (
    <>
      {sections.map(({ account, posts }) =>
        posts.length === 0 ? null : (
          <section key={account.id}>
            <h2>@{account.username}</h2>
            {posts.map((post) => (
              <ApprovalCard key={post.id} post={post} timezone="UTC" />
            ))}
          </section>
        ),
      )}
    </>
  );
}
