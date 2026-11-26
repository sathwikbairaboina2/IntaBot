import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from "@nestjs/common";
import { beforeEach, describe, expect, it } from "vitest";
import type { Account } from "@intabot/shared";
import { FakeInstagramAdapter } from "../instagram/fake-instagram.adapter";
import { GraphApiError } from "../instagram/graph-responses";
import {
  MemoryAccounts,
  MemoryAudit,
  MemoryCaps,
  MemoryComments,
  makeAccount,
} from "../../test/memory-stubs";
import { CommentActionsService } from "./comment-actions.service";

describe("CommentActionsService", () => {
  let comments: MemoryComments;
  let ig: FakeInstagramAdapter;
  let caps: MemoryCaps;
  let audit: MemoryAudit;
  let service: CommentActionsService;

  async function build(account: Account) {
    comments = new MemoryComments();
    ig = new FakeInstagramAdapter();
    caps = new MemoryCaps();
    audit = new MemoryAudit();
    service = new CommentActionsService(
      comments as never,
      new MemoryAccounts([account]) as never,
      ig,
      caps as never,
      audit as never,
    );
    await comments.create({
      igCommentId: "c-1",
      accountId: "acct-1",
      postId: "p-1",
      igMediaId: "m-1",
      text: "is this remote?",
      fromIgUserId: "u-9",
      fromUsername: "someone",
    });
  }

  describe("live (fake adapter)", () => {
    beforeEach(() => build(makeAccount({ dryRun: false })));

    it("replies publicly, records it and counts toward the caps", async () => {
      const updated = await service.reply("p-1", "c-1", "Yes, remote.");
      expect(ig.getReplies()).toHaveLength(1);
      expect(ig.getReplies()[0]).toMatchObject({ commentId: "c-1", text: "Yes, remote." });
      expect(updated).toMatchObject({
        status: "HUMAN_REPLIED",
        replyText: "Yes, remote.",
        replyId: ig.getReplies()[0]!.replyId,
        policyRule: "human-replied",
      });
      expect(caps.increments).toBe(1);
      expect(audit.entries).toEqual([
        expect.objectContaining({
          actor: "human",
          action: "comment.reply",
          igCommentId: "c-1",
          postId: "p-1",
          accountId: "acct-1",
        }),
      ]);
    });

    it("sends a private reply and keeps the status", async () => {
      const updated = await service.dm("p-1", "c-1", "Here is the link.");
      expect(ig.getDms()[0]).toMatchObject({ commentId: "c-1", text: "Here is the link." });
      expect(updated).toMatchObject({
        status: "RECEIVED",
        dmText: "Here is the link.",
        dmId: ig.getDms()[0]!.messageId,
      });
      expect(caps.increments).toBe(1);
      expect(audit.entries[0]).toMatchObject({ action: "comment.dm" });
    });

    it("hides and unhides through the port", async () => {
      expect((await service.hide("p-1", "c-1", true)).hidden).toBe(true);
      expect((await service.hide("p-1", "c-1", false)).hidden).toBe(false);
      expect(ig.getHides().map((h) => h.hidden)).toEqual([true, false]);
      expect(audit.entries.map((e) => e.action)).toEqual(["comment.hide", "comment.unhide"]);
      expect(caps.increments).toBe(0);
    });

    it("deletes through the port and keeps the record marked deleted", async () => {
      const updated = await service.remove("p-1", "c-1");
      expect(ig.getDeletes()).toEqual([{ accountId: "acct-1", commentId: "c-1" }]);
      expect(updated.deleted).toBe(true);
      expect(audit.entries[0]).toMatchObject({ action: "comment.delete" });
      await expect(service.reply("p-1", "c-1", "late")).rejects.toBeInstanceOf(ConflictException);
      expect(ig.getReplies()).toHaveLength(0);
    });

    it("refuses a reply and a DM when a reply cap is reached", async () => {
      caps.postCapReached = true;
      for (const act of [
        () => service.reply("p-1", "c-1", "x"),
        () => service.dm("p-1", "c-1", "x"),
      ]) {
        const err = await act().catch((e: unknown) => e);
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(429);
      }
      caps.postCapReached = false;
      caps.accountCapReached = true;
      const err = await service.reply("p-1", "c-1", "x").catch((e: unknown) => e);
      expect((err as HttpException).getStatus()).toBe(429);
      expect(ig.getReplies()).toHaveLength(0);
      expect(ig.getDms()).toHaveLength(0);
      expect(audit.entries).toHaveLength(0);
    });

    it("answers 404 for an unknown comment", async () => {
      await expect(service.reply("p-1", "nope", "x")).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.hide("p-other", "c-1", true)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("puts the comment back and answers 502 when Instagram refuses", async () => {
      ig.replyToComment = async () => {
        throw new GraphApiError(100, "comment is gone");
      };
      await expect(service.reply("p-1", "c-1", "x")).rejects.toBeInstanceOf(BadGatewayException);
      expect(await comments.get("p-1", "c-1")).toMatchObject({ status: "RECEIVED" });
      expect((await comments.get("p-1", "c-1"))?.replyText).toBeUndefined();
      expect(caps.increments).toBe(0);
      expect(audit.entries).toHaveLength(0);
    });
  });

  describe("DM state and the private reply window", () => {
    beforeEach(() => build(makeAccount({ dryRun: false })));

    const age = (days: number) => {
      const c = comments.items.get("p-1|c-1")!;
      comments.items.set("p-1|c-1", {
        ...c,
        createdAt: new Date(Date.now() - days * 86_400_000).toISOString(),
      });
    };

    it("marks a sent DM as dmState sent", async () => {
      expect((await service.dm("p-1", "c-1", "Link")).dmState).toBe("sent");
    });

    it("records dmState failed with the error when Instagram refuses, and still answers 502", async () => {
      ig.sendPrivateReply = async () => {
        throw new GraphApiError(10, "no permission", { status: 403 });
      };
      await expect(service.dm("p-1", "c-1", "Link")).rejects.toBeInstanceOf(BadGatewayException);
      expect(await comments.get("p-1", "c-1")).toMatchObject({
        status: "RECEIVED",
        dmState: "failed",
        dmError: "graph 10: no permission",
        dmText: "Link",
      });
      expect(caps.increments).toBe(0);
    });

    it("resends a failed DM from its stored text without a body", async () => {
      ig.sendPrivateReply = async () => {
        throw new GraphApiError(10, "no permission", { status: 403 });
      };
      await service.dm("p-1", "c-1", "Link").catch(() => undefined);
      ig.sendPrivateReply = FakeInstagramAdapter.prototype.sendPrivateReply.bind(ig);

      const resent = await service.dm("p-1", "c-1");
      expect(ig.getDms()).toHaveLength(1);
      expect(ig.getDms()[0]).toMatchObject({ commentId: "c-1", text: "Link" });
      expect(resent).toMatchObject({ dmState: "sent", dmText: "Link" });
      expect(resent.dmId).toBe(ig.getDms()[0]!.messageId);
    });

    it("answers 400 when there is no text and nothing to resend", async () => {
      await expect(service.dm("p-1", "c-1")).rejects.toBeInstanceOf(BadRequestException);
    });

    it("refuses a private reply to a comment older than 7 days with 409 and a clear message", async () => {
      age(8);
      const err = await service.dm("p-1", "c-1", "Link").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).toMatch(/7 days/);
      expect(ig.getDms()).toHaveLength(0);
      expect(caps.increments).toBe(0);
      expect((await comments.get("p-1", "c-1"))?.version).toBe(1);
    });

    it("allows one just inside the window, and a public reply at any age", async () => {
      age(6.9);
      await service.dm("p-1", "c-1", "Link");
      age(30);
      await service.reply("p-1", "c-1", "Yes.");
      expect(ig.getDms()).toHaveLength(1);
      expect(ig.getReplies()).toHaveLength(1);
    });
  });

  describe("dry run", () => {
    beforeEach(() => build(makeAccount({ dryRun: true })));

    it("records dryrun ids and calls nothing", async () => {
      const replied = await service.reply("p-1", "c-1", "Yes.");
      expect(replied.replyId).toMatch(/^dryrun-/);
      const dmed = await service.dm("p-1", "c-1", "Link");
      expect(dmed.dmId).toMatch(/^dryrun-/);
      expect(dmed.dmState).toBe("sent");
      expect((await service.hide("p-1", "c-1", true)).hidden).toBe(true);
      expect((await service.remove("p-1", "c-1")).deleted).toBe(true);

      expect(ig.getReplies()).toHaveLength(0);
      expect(ig.getDms()).toHaveLength(0);
      expect(ig.getHides()).toHaveLength(0);
      expect(ig.getDeletes()).toHaveLength(0);
      expect(audit.entries).toHaveLength(4);
      expect(audit.entries.every((e) => e.dryRun === true)).toBe(true);
    });
  });
});
