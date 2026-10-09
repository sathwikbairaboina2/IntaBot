import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  getMe: vi.fn(),
  getAccounts: vi.fn(),
  getApprovals: vi.fn(),
  getModeration: vi.fn(),
}));

import type { AccountView, ModerationView, PostView } from "./api";
import { getApprovals, getModeration } from "./api";
import { getNavCounts } from "./queries";

const acct = (id: string) => ({ id }) as AccountView;
const posts = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }) as PostView);
const moderation = (escalated: number, auto: number): ModerationView =>
  ({ escalated: Array(escalated).fill({}), recentAutoReplies: Array(auto).fill({}) }) as ModerationView;

beforeEach(() => vi.clearAllMocks());

describe("getNavCounts", () => {
  it("sums drafts and escalated comments across accounts", async () => {
    vi.mocked(getApprovals).mockImplementation(async (id) => posts(id === "a" ? 2 : 1));
    vi.mocked(getModeration).mockImplementation(async (id) => moderation(id === "a" ? 1 : 3, 5));
    expect(await getNavCounts([acct("a"), acct("b")])).toEqual({ approvals: 3, moderation: 4 });
  });

  it("hides only the count whose calls fail", async () => {
    vi.mocked(getApprovals).mockRejectedValue(new Error("down"));
    vi.mocked(getModeration).mockResolvedValue(moderation(2, 0));
    expect(await getNavCounts([acct("a")])).toEqual({ approvals: null, moderation: 2 });
  });

  it("is zero with no accounts and makes no calls", async () => {
    expect(await getNavCounts([])).toEqual({ approvals: 0, moderation: 0 });
    expect(getApprovals).not.toHaveBeenCalled();
  });
});
