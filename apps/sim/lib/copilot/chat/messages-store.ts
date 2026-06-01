import { db } from '@sim/db'
import { copilotMessages } from '@sim/db/schema'
import { and, eq, notInArray, sql } from 'drizzle-orm'
import { type PersistedMessage, stripToolResultOutput } from '@/lib/copilot/chat/persisted-message'
import type { DbOrTx } from '@/lib/db/types'

/**
 * Keep the first occurrence of each message id. A single `INSERT ... ON
 * CONFLICT` cannot touch the same conflict target twice, so a repeated id
 * would otherwise throw.
 */
function dedupeById(messages: PersistedMessage[]): PersistedMessage[] {
  const seen = new Set<string>()
  const out: PersistedMessage[] = []
  for (const m of messages) {
    if (seen.has(m.id)) continue
    seen.add(m.id)
    out.push(m)
  }
  return out
}

function toRow(
  chatId: string,
  message: PersistedMessage,
  seq: number,
  options?: { chatModel?: string | null; streamId?: string | null }
): typeof copilotMessages.$inferInsert {
  const ts = new Date(message.timestamp)
  return {
    chatId,
    messageId: message.id,
    role: message.role,
    content: stripToolResultOutput(message),
    seq,
    model: options?.chatModel ?? null,
    streamId: options?.streamId ?? null,
    createdAt: ts,
    updatedAt: ts,
  }
}

/**
 * Append messages to the `copilot_messages` table — the sole store for chat
 * transcripts. Throws on failure (a swallowed write would lose messages).
 * Pass `executor` to enlist the write in an existing transaction.
 *
 * `seq` is `MAX(seq) + index`, computed in JS. The read-then-insert is
 * non-atomic, but per-chat appends are serialized by the pending-stream lock
 * and the `seq, created_at, id` read order breaks any residual tie.
 */
export async function appendCopilotChatMessages(
  chatId: string,
  messages: PersistedMessage[],
  options?: { chatModel?: string | null; streamId?: string | null },
  executor: DbOrTx = db
): Promise<void> {
  if (messages.length === 0) return
  const deduped = dedupeById(messages)
  const [maxRow] = await executor
    .select({ maxSeq: sql<number | null>`max(${copilotMessages.seq})` })
    .from(copilotMessages)
    .where(eq(copilotMessages.chatId, chatId))
  const base = (maxRow?.maxSeq ?? -1) + 1
  await executor
    .insert(copilotMessages)
    .values(deduped.map((m, i) => toRow(chatId, m, base + i, options)))
    .onConflictDoUpdate({
      target: [copilotMessages.chatId, copilotMessages.messageId],
      set: {
        content: sql`excluded.content`,
        role: sql`excluded.role`,
        model: sql`COALESCE(excluded.model, ${copilotMessages.model})`,
        streamId: sql`COALESCE(excluded.stream_id, ${copilotMessages.streamId})`,
        seq: sql`COALESCE(${copilotMessages.seq}, excluded.seq)`,
        updatedAt: sql`now()`,
      },
    })
}

/**
 * Replace all messages for a chat from a full snapshot (used by update-messages).
 * Throws on failure. Pass `executor` to enlist the delete+insert in an existing
 * transaction; otherwise it runs in its own.
 */
export async function replaceCopilotChatMessages(
  chatId: string,
  messages: PersistedMessage[],
  options?: { chatModel?: string | null },
  executor?: DbOrTx
): Promise<void> {
  const deduped = dedupeById(messages)
  const newMessageIds = deduped.map((m) => m.id)
  const run = async (tx: DbOrTx) => {
    await tx
      .delete(copilotMessages)
      .where(
        newMessageIds.length > 0
          ? and(
              eq(copilotMessages.chatId, chatId),
              notInArray(copilotMessages.messageId, newMessageIds)
            )
          : eq(copilotMessages.chatId, chatId)
      )
    if (deduped.length === 0) return
    await tx
      .insert(copilotMessages)
      .values(deduped.map((m, i) => toRow(chatId, m, i, options)))
      .onConflictDoUpdate({
        target: [copilotMessages.chatId, copilotMessages.messageId],
        set: {
          content: sql`excluded.content`,
          role: sql`excluded.role`,
          model: sql`COALESCE(excluded.model, ${copilotMessages.model})`,
          streamId: sql`COALESCE(excluded.stream_id, ${copilotMessages.streamId})`,
          seq: sql`excluded.seq`,
          updatedAt: sql`now()`,
        },
      })
  }
  await (executor ? run(executor) : db.transaction(run))
}
