import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeInstagramAdapter } from "../instagram/fake-instagram.adapter";
import {
  MemoryAccounts,
  MemoryAudit,
  MemoryCaps,
  MemoryComments,
  makeAccount,
} from "../../test/memory-stubs";
import { CommentActionsService } from "./comment-actions.service";
import { CommentsController } from "./comments.controller";

describe("CommentsController", () => {
  let comments: MemoryComments;
  let ig: FakeInstagramAdapter;
  let controller: CommentsController;

  beforeEach(async () => {
    comments = new MemoryComments();
    ig = new FakeInstagramAdapter();
    const actions = new CommentActionsService(
      comments as never,
      new MemoryAccounts([makeAccount({ dryRun: false })]) as never,
      ig,
      new MemoryCaps() as never,
      new MemoryAudit() as never,
    );
    controller = new CommentsController(comments as never, actions);
    for (const [id, postId] of [
      ["c-1", "p-1"],
      ["c-2", "p-1"],
      ["c-3", "p-2"],
    ] as const) {
      await comments.create({
        igCommentId: id,
        accountId: "acct-1",
        postId,
        igMediaId: "m-1",
        text: `text ${id}`,
        fromIgUserId: "u-9",
        fromUsername: "someone",
      });
    }
  });

  it("lists the comments of a post with the panel's fields", async () => {
    const views = await controller.forPost("p-1");
    expect(views.map((v) => v.id)).toEqual(["c-1", "c-2"]);
    expect(views[0]).toMatchObject({
      id: "c-1",
      igCommentId: "c-1",
      postId: "p-1",
      author: "someone",
      text: "text c-1",
      status: "RECEIVED",
      replyText: null,
      dmText: null,
      hidden: false,
    });
    expect(views[0]!.createdAt).toBeTypeOf("string");
  });

  it("pages recent comments with a cursor and validates the query", async () => {
    const first = await controller.recent({ accountId: "acct-1", limit: "2" });
    expect(first.items.map((v) => v.id)).toEqual(["c-3", "c-2"]);
    expect(first.nextCursor).not.toBeNull();
    const second = await controller.recent({ accountId: "acct-1", limit: "2", cursor: first.nextCursor });
    expect(second.items.map((v) => v.id)).toEqual(["c-1"]);
    expect(second.nextCursor).toBeNull();

    await expect(controller.recent({})).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.recent({ accountId: "acct-1", status: "NOPE" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.recent({ accountId: "acct-1", since: "yesterday" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("replies, taking postId from the body or the query", async () => {
    const byBody = await controller.reply("c-1", { postId: "p-1", text: " Thanks! " });
    expect(byBody).toMatchObject({ status: "HUMAN_REPLIED", replyText: "Thanks!" });
    const byQuery = await controller.reply("c-2", { text: "Yes" }, "p-1");
    expect(byQuery.replyText).toBe("Yes");
    expect(ig.getReplies()).toHaveLength(2);
  });

  it("rejects a missing postId, empty text and a non-boolean hidden with 400", async () => {
    await expect(controller.reply("c-1", { text: "x" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.reply("c-1", { postId: "p-1", text: "  " })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.dm("c-1", { postId: "p-1" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.hide("c-1", { postId: "p-1", hidden: "yes" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.remove("c-1")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("sends a DM, hides and deletes", async () => {
    expect((await controller.dm("c-1", { postId: "p-1", text: "link" })).dmText).toBe("link");
    expect((await controller.hide("c-1", { postId: "p-1", hidden: true })).hidden).toBe(true);
    expect((await controller.remove("c-1", "p-1")).deleted).toBe(true);
    expect(ig.getDms()).toHaveLength(1);
    expect(ig.getHides()).toHaveLength(1);
    expect(ig.getDeletes()).toHaveLength(1);
  });
});
