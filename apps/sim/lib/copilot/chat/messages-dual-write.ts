import { db } from '@sim/db'
import { copilotMessages } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, notInArray, sql } from 'drizzle-orm'
import type { PersistedMessage } from '@/lib/copilot/chat/persisted-message'

const logger = createLogger('CopilotMessagesDualWrite')

function toRow(
  chatId: string,
  message: PersistedMessage,
  options?: { chatModel?: string | null; streamId?: string | null }
): typeof copilotMessages.$inferInsert {
  const ts = new Date(message.timestamp)
  return {
    chatId,
    messageId: message.id,
    role: message.role,
    content: message,
    model: options?.chatModel ?? null,
    streamId: options?.streamId ?? null,
    createdAt: ts,
    updatedAt: ts,
  }
}

/**
 * Append messages to the new `copilot_messages` table. Best-effort — errors
 * are logged but never thrown, since the legacy `copilot_chats.messages`
 * JSONB column remains the source of truth during the dual-write rollout.
 */
export async function appendCopilotChatMessages(
  chatId: string,
  messages: PersistedMessage[],
  options?: { chatModel?: string | null; streamId?: string | null }
): Promise<void> {
  if (messages.length === 0) return
  try {
    await db
      .insert(copilotMessages)
      .values(messages.map((m) => toRow(chatId, m, options)))
      .onConflictDoUpdate({
        target: [copilotMessages.chatId, copilotMessages.messageId],
        set: {
          content: sql`excluded.content`,
          role: sql`excluded.role`,
          model: sql`COALESCE(excluded.model, ${copilotMessages.model})`,
          streamId: sql`COALESCE(excluded.stream_id, ${copilotMessages.streamId})`,
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
    const newMessageIds = messages.map((m) => m.id)
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
      if (messages.length === 0) return
      // Upsert remaining rows. ON CONFLICT preserves existing stream_id / model
      // so a snapshot save doesn't clobber metadata set during streaming.
      await tx
        .insert(copilotMessages)
        .values(messages.map((m) => toRow(chatId, m, options)))
        .onConflictDoUpdate({
          target: [copilotMessages.chatId, copilotMessages.messageId],
          set: {
            content: sql`excluded.content`,
            role: sql`excluded.role`,
            model: sql`COALESCE(excluded.model, ${copilotMessages.model})`,
            streamId: sql`COALESCE(excluded.stream_id, ${copilotMessages.streamId})`,
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
