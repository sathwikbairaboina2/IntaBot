import { getAccounts, getModeration } from "@/lib/api";
import { EscalationCard } from "./escalation-card";

// Moderation happens asynchronously, so the queue is re-fetched on an
// interval rather than requiring a manual reload. SSE replaces this in
// Phase 5.
export const revalidate = 5;

export default async function ModerationPage() {
  const accounts = await getAccounts();
  if (accounts.length === 0) return <p>Connect an account first.</p>;

  const sections = await Promise.all(
    accounts.map(async (account) => ({
      account,
      moderation: await getModeration(account.id),
    })),
  );

  const total = sections.reduce(
    (n, s) => n + s.moderation.escalated.length + s.moderation.recentAutoReplies.length,
    0,
  );
  if (total === 0) return <p>No comments yet.</p>;

  return (
    <>
      {sections.map(({ account, moderation }) => {
        if (moderation.escalated.length === 0 && moderation.recentAutoReplies.length === 0) {
          return null;
        }
        return (
          <section key={account.id}>
            <h2>@{account.username}</h2>

            {moderation.escalated.length > 0 ? (
              <>
                <h3>Waiting for you</h3>
                {moderation.escalated.map((comment) => (
                  <EscalationCard key={comment.igCommentId} comment={comment} />
                ))}
              </>
            ) : null}

            {moderation.recentAutoReplies.length > 0 ? (
              <>
                <h3>Recent auto-replies</h3>
                {moderation.recentAutoReplies.map((comment) => (
                  <article
                    key={comment.igCommentId}
                    style={{ border: "1px solid #8883", padding: "1rem", marginBottom: "1rem" }}
                  >
                    <p>
                      <strong>@{comment.fromUsername}</strong>: {comment.text}
                    </p>
                    <p>↳ {comment.replyText}</p>
                    <p style={{ fontSize: "0.85rem", opacity: 0.8 }}>
                      {comment.classification
                        ? `${comment.classification.intent} · ${comment.classification.sentiment}`
                        : "unclassified"}
                    </p>
                  </article>
                ))}
              </>
            ) : null}
          </section>
        );
      })}
    </>
  );
}
