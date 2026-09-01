import { db } from '@sim/db'
import { copilotChats, copilotMessages } from '@sim/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
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
 * Persist one completed turn — the user message and the assistant reply — into
 * a chat's transcript, bumping the chat's `updatedAt` so it sorts by recency.
 *
 * Headless callers need this because the orchestrator never writes messages:
 * the interactive web surface persists them from its own client store, so a
 * turn run without that surface would leave a chat that opens to nothing.
 *
 * Both messages are written in a single transaction, so a failure leaves the
 * transcript untouched rather than showing a question with no answer.
 *
 * The chat row is claimed under the same liveness predicate the accessible-chat
 * loaders use, so a chat soft-deleted while the turn was running receives
 * nothing: the update matches no row and the transaction returns having written
 * neither the transcript nor the recency bump. Dropping the turn is right here
 * because the user deleted the conversation after asking — resurrecting it with
 * a reply would undo that deletion, and the caller still has its reply in the
 * response. Throws on a write failure.
 */
export async function persistCopilotChatTurn(
  chatId: string,
  messages: PersistedMessage[]
): Promise<void> {
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(copilotChats)
      .set({ updatedAt: new Date() })
      .where(and(eq(copilotChats.id, chatId), isNull(copilotChats.deletedAt)))
      .returning({ model: copilotChats.model })
    if (!updated) return
    await appendCopilotChatMessages(chatId, messages, { chatModel: updated.model ?? null }, tx)
  })
}
