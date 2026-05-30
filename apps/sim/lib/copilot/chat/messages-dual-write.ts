import { db } from '@sim/db'
import { copilotMessages } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, notInArray, sql } from 'drizzle-orm'
import type { PersistedMessage } from '@/lib/copilot/chat/persisted-message'

const logger = createLogger('CopilotMessagesDualWrite')

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
    content: message,
    seq,
    model: options?.chatModel ?? null,
    streamId: options?.streamId ?? null,
    createdAt: ts,
    updatedAt: ts,
  }
}

/**
 * Append messages to the new `copilot_messages` table. Best-effort — errors
 * are logged but never thrown; the legacy `copilot_chats.messages` JSONB
 * column stays the source of truth during the dual-write rollout.
 *
 * `seq` is `MAX(seq) + index`, computed in JS (not in SQL, where every row of
 * a multi-row INSERT would read the same pre-insert MAX and collide). The
 * read-then-insert is non-atomic, so interleaved appends to one chat can tie
 * `seq`; that window is bounded by the cutover read order (`seq, created_at,
 * id`) and `replaceCopilotChatMessages`, which re-densifies `seq` from the
 * authoritative JSONB order on the next snapshot save.
 */
export async function appendCopilotChatMessages(
  chatId: string,
  messages: PersistedMessage[],
  options?: { chatModel?: string | null; streamId?: string | null }
): Promise<void> {
  if (messages.length === 0) return
  try {
    const deduped = dedupeById(messages)
    const [maxRow] = await db
      .select({ maxSeq: sql<number | null>`max(${copilotMessages.seq})` })
      .from(copilotMessages)
      .where(eq(copilotMessages.chatId, chatId))
    const base = (maxRow?.maxSeq ?? -1) + 1
    await db
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
  } catch (err) {
    logger.warn('Failed to append copilot chat messages', {
      chatId,
      messageCount: messages.length,
      error: getErrorMessage(err),
    })
  }
}

/**
 * Replace all messages for a chat. Used by the update-messages endpoint that
 * receives a full snapshot of the conversation state. Best-effort.
 */
export async function replaceCopilotChatMessages(
  chatId: string,
  messages: PersistedMessage[],
  options?: { chatModel?: string | null }
): Promise<void> {
  try {
    const deduped = dedupeById(messages)
    const newMessageIds = deduped.map((m) => m.id)
    await db.transaction(async (tx) => {
      // Drop rows for messages not in the new snapshot.
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
      // Snapshot is authoritative on order, so seq = array index is overwritten
      // on conflict; stream_id / model are preserved via COALESCE.
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
    })
  } catch (err) {
    logger.warn('Failed to replace copilot chat messages', {
      chatId,
      messageCount: messages.length,
      error: getErrorMessage(err),
    })
  }
}
