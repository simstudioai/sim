import { db } from '@sim/db'
import { copilotChatMessages } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { eq, sql } from 'drizzle-orm'

const logger = createLogger('CopilotChatMessagesDualWrite')

/**
 * Build a row payload for `copilot_chat_messages` from a JSONB message blob.
 * The blob format mirrors what's stored in the legacy `copilot_chats.messages`
 * array — `id`, `role`, and optionally `model`/`createdAt` at the top level —
 * with the entire blob preserved as the row's `content` for forward compat.
 */
function toMessageRow(
  chatId: string,
  rawMessage: unknown,
  options?: { chatModel?: string | null; streamId?: string | null }
): typeof copilotChatMessages.$inferInsert | null {
  if (!rawMessage || typeof rawMessage !== 'object') return null
  const msg = rawMessage as Record<string, unknown>
  const id = typeof msg.id === 'string' && msg.id.length > 0 ? msg.id : generateShortId()
  const role = typeof msg.role === 'string' ? msg.role : 'user'
  const model =
    typeof msg.model === 'string' && msg.model.length > 0 ? msg.model : (options?.chatModel ?? null)
  return {
    chatId,
    messageId: id,
    role,
    content: msg,
    model,
    streamId: options?.streamId ?? null,
  }
}

/**
 * Append messages to the new `copilot_chat_messages` table. Best-effort —
 * errors are logged but never thrown, since the legacy `copilot_chats.messages`
 * JSONB column remains the source of truth during the dual-write rollout.
 */
export async function appendCopilotChatMessages(
  chatId: string,
  messages: unknown[],
  options?: { chatModel?: string | null; streamId?: string | null }
): Promise<void> {
  if (!Array.isArray(messages) || messages.length === 0) return

  const rows = messages
    .map((msg) => toMessageRow(chatId, msg, options))
    .filter((row): row is typeof copilotChatMessages.$inferInsert => row !== null)

  if (rows.length === 0) return

  try {
    await db
      .insert(copilotChatMessages)
      .values(rows)
      .onConflictDoUpdate({
        target: [copilotChatMessages.chatId, copilotChatMessages.messageId],
        set: {
          content: sql`excluded.content`,
          role: sql`excluded.role`,
          model: sql`excluded.model`,
          updatedAt: sql`now()`,
        },
      })
  } catch (err) {
    logger.warn('Failed to append copilot chat messages', {
      chatId,
      messageCount: rows.length,
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
  messages: unknown[],
  options?: { chatModel?: string | null }
): Promise<void> {
  if (!Array.isArray(messages)) return

  const rows = messages
    .map((msg) => toMessageRow(chatId, msg, options))
    .filter((row): row is typeof copilotChatMessages.$inferInsert => row !== null)

  try {
    await db.transaction(async (tx) => {
      await tx.delete(copilotChatMessages).where(eq(copilotChatMessages.chatId, chatId))
      if (rows.length > 0) {
        await tx.insert(copilotChatMessages).values(rows)
      }
    })
  } catch (err) {
    logger.warn('Failed to replace copilot chat messages', {
      chatId,
      messageCount: rows.length,
      error: getErrorMessage(err),
    })
  }
}
