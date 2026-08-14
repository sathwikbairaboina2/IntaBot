import type { PostFormat } from "@intabot/shared";
import { CopyWriterRefusalError, type CopyWriterPort } from "./copy-writer.port";
import { nextFreeSlot } from "./slot-planner";

/**
 * Drafting is three sequential steps with no branching, no cycles and nothing
 * to suspend, so it is written as plain async code. An earlier draft used a
 * LangGraph StateGraph; it added ~40 lines of annotation boilerplate plus a
 * workspace-wide dependency override, and bought nothing. Phase 3's moderation
 * flow branches and may genuinely warrant a graph — this one does not.
 */
export interface DraftingDeps {
  copyWriter: CopyWriterPort;
  loadAccount(accountId: string): Promise<{
    voice: string;
    timezone: string;
    postingWindows: string[];
  }>;
  loadRecentCaptions(accountId: string): Promise<string[]>;
  loadTakenSlots(accountId: string, fromIso: string): Promise<string[]>;
  now(): Date;
}

export interface DraftingInput {
  accountId: string;
  assetId: string;
  format: PostFormat;
}

export interface DraftingResult {
  caption: string;
  hashtags: string[];
  altText: string;
  scheduledAt: string;
  needsAttention: boolean;
}

interface Copy {
  caption: string;
  hashtags: string[];
  altText: string;
  needsAttention: boolean;
}

async function draftCopy(
  deps: DraftingDeps,
  args: { voice: string; format: PostFormat; recentCaptions: string[] },
): Promise<Copy> {
  try {
    const out = await deps.copyWriter.draft({
      accountVoice: args.voice,
      format: args.format,
      recentCaptions: args.recentCaptions,
      mediaMeta: { contentType: "" },
    });
    return { ...out, needsAttention: false };
  } catch (err) {
    // A refusal is an expected outcome: the post still reaches the queue with
    // empty copy for a human to write. Anything else is a real failure and
    // must propagate so the job retries.
    if (err instanceof CopyWriterRefusalError) {
      return { caption: "", hashtags: [], altText: "", needsAttention: true };
    }
    throw err;
  }
}

export async function runDrafting(
  deps: DraftingDeps,
  input: DraftingInput,
): Promise<DraftingResult> {
  const [account, recentCaptions] = await Promise.all([
    deps.loadAccount(input.accountId),
    deps.loadRecentCaptions(input.accountId),
  ]);

  const copy = await draftCopy(deps, {
    voice: account.voice,
    format: input.format,
    recentCaptions,
  });

  const now = deps.now();
  const takenAt = await deps.loadTakenSlots(input.accountId, now.toISOString());
  const scheduledAt = nextFreeSlot({
    now,
    timezone: account.timezone,
    windows: account.postingWindows,
    takenAt,
  });

  return { ...copy, scheduledAt };
}
