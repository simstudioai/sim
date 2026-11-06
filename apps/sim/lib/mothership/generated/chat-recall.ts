// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/chat-recall.ts
// Regenerate with `bun run contracts:sync` in the worker.

import { z } from "zod";

/** The chats a conversation may read back besides its own: its user's live chats in its workspace or organization. */
export const RecallChatsRequest = z.object({
  chatId: z.uuid(),
  limit: z.number().int().min(1).max(200),
});
export type RecallChatsRequest = z.infer<typeof RecallChatsRequest>;

export const RecallChat = z.object({
  id: z.uuid(),
  title: z.string().nullable(),
  updatedAt: z.string().datetime(),
});
export type RecallChat = z.infer<typeof RecallChat>;

/** Most recently updated first; deleted chats never appear. */
export const RecallChatsResponse = z.object({
  userId: z.string().min(1),
  chats: z.array(RecallChat).max(200),
});
export type RecallChatsResponse = z.infer<typeof RecallChatsResponse>;
