import type { Account, Classification } from "@intabot/shared";

export type GateAction = "reply" | "escalate" | "ignore";

export interface GateInput {
  account: Account;
  fromIgUserId: string;
  commentText: string;
  /** null when the flow short-circuited before the model ran. */
  classification: Classification | null;
  postCapReached: boolean;
  accountCapReached: boolean;
}

export interface GateVerdict {
  action: GateAction;
  rule: string;
}

/**
 * The model classifies; this code decides. Rules run in a fixed order, and the
 * self-reply guard must stay first: the account's own reply fires another
 * webhook, and without it the system holds an infinite conversation with
 * itself on its own post.
 */
export function policyGate(input: GateInput): GateVerdict {
  const { account, classification } = input;

  if (input.fromIgUserId === account.igUserId) {
    return { action: "ignore", rule: "self-reply-guard" };
  }

  if (account.moderationPaused) {
    return { action: "ignore", rule: "paused" };
  }

  const text = input.commentText.toLowerCase();
  if (account.blocklist.some((term) => text.includes(term.toLowerCase()))) {
    return { action: "escalate", rule: "blocklist" };
  }

  if (classification === null) {
    return { action: "escalate", rule: "unclassified" };
  }

  if (classification.needsHuman) {
    return { action: "escalate", rule: "needs-human" };
  }

  if (classification.isSpam) {
    return { action: "ignore", rule: "spam" };
  }

  if (input.postCapReached || input.accountCapReached) {
    // A capped genuine comment still deserves a human, so escalate, not drop.
    return { action: "escalate", rule: "cap-exceeded" };
  }

  return { action: "reply", rule: "default" };
}
