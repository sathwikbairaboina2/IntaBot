import type { PostStatus } from "@intabot/shared";

export const keys = {
  account: (accountId: string) => ({ PK: `ACCT#${accountId}`, SK: "#META" }),
  accountListIndex: (name: string) => ({ GSI1PK: "TYPE#ACCOUNT", GSI1SK: name }),

  mediaAsset: (accountId: string, assetId: string) => ({
    PK: `ACCT#${accountId}`,
    SK: `ASSET#${assetId}`,
  }),

  post: (accountId: string, postId: string) => ({
    PK: `ACCT#${accountId}`,
    SK: `POST#${postId}`,
  }),
  postStatusIndex: (accountId: string, status: PostStatus, scheduledAt: string) => ({
    GSI1PK: `ACCT#${accountId}#ST#${status}`,
    GSI1SK: scheduledAt,
  }),

  comment: (postId: string, igCommentId: string) => ({
    PK: `POST#${postId}`,
    SK: `CMT#${igCommentId}`,
  }),
  commentStatusIndex: (accountId: string, status: string, createdAt: string) => ({
    GSI1PK: `ACCT#${accountId}#CST#${status}`,
    GSI1SK: createdAt,
  }),

  /** Inverse lookup written at publish time: which post owns an ig media id. */
  igMediaRef: (igMediaId: string) => ({ PK: `IGM#${igMediaId}`, SK: "#" }),

  accountInsights: (accountId: string, date: string) => ({
    PK: `ACCT#${accountId}#INS#ACCOUNT`,
    SK: date,
  }),
  mediaInsights: (accountId: string, igMediaId: string, date: string) => ({
    PK: `ACCT#${accountId}#INS#MEDIA#${igMediaId}`,
    SK: date,
  }),

  auditLog: (accountId: string, sortKey: string) => ({
    PK: `ACCT#${accountId}#LOG`,
    SK: sortKey,
  }),
  webhookSeen: (eventId: string) => ({ PK: `WH#${eventId}`, SK: "#" }),

  user: (email: string) => ({ PK: `USER#${email.toLowerCase()}`, SK: "#META" }),
  session: (tokenHash: string) => ({ PK: `SESSION#${tokenHash}`, SK: "#" }),
} as const;
