import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { eq, sql } from 'drizzle-orm'
import {
  type MothershipResource,
  type MothershipResourceUpdate,
  mergeChatResource,
  sanitizeChatResources,
} from '@/lib/copilot/resources/types'

export {
  extractDeletedResourcesFromToolResult,
  extractResourcesFromToolResult,
  hasDeleteCapability,
  isResourceToolName,
} from '@/lib/copilot/resources/extraction'
export type {
  MothershipResource as ChatResource,
  MothershipResourceType as ResourceType,
} from '@/lib/copilot/resources/types'

const logger = createLogger('CopilotResources')

type ChatResource = MothershipResource

const chatResourceWriteChain = new Map<string, Promise<void>>()

async function serializeChatResourceWrite(
  chatId: string,
  write: () => Promise<void>
): Promise<void> {
  const tail = chatResourceWriteChain.get(chatId) ?? Promise.resolve()
  const run = tail.catch(() => {}).then(write)
  chatResourceWriteChain.set(chatId, run)
  try {
    await run
  } finally {
    if (chatResourceWriteChain.get(chatId) === run) chatResourceWriteChain.delete(chatId)
  }
}

/**
 * Appends resources to a chat's JSONB resources column, deduplicating by type+id.
 * Updates the title of existing resources if the new title is more specific.
 */
export async function persistChatResources(
  chatId: string,
  newResources: MothershipResourceUpdate[]
): Promise<void> {
  const toMerge = newResources.filter((r) => r.id !== 'streaming-file')
  if (toMerge.length === 0) return

  try {
    await serializeChatResourceWrite(chatId, async () => {
      await db.transaction(async (tx) => {
        const [chat] = await tx
          .select({ resources: copilotChats.resources })
          .from(copilotChats)
          .where(eq(copilotChats.id, chatId))
          .for('update')
          .limit(1)

        if (!chat) return

        const existing = sanitizeChatResources(
          Array.isArray(chat.resources) ? (chat.resources as ChatResource[]) : []
        )
        const map = new Map<string, ChatResource>()

        for (const r of existing) {
          map.set(`${r.type}:${r.id}`, r)
        }

        for (const r of sanitizeChatResources(toMerge)) {
          const key = `${r.type}:${r.id}`
          map.set(key, mergeChatResource(map.get(key), r))
        }

        const merged = Array.from(map.values())

        await tx
          .update(copilotChats)
          .set({ resources: sql`${JSON.stringify(merged)}::jsonb` })
          .where(eq(copilotChats.id, chatId))
      })
    })
  } catch (err) {
    logger.warn('Failed to persist chat resources', {
      chatId,
      error: toError(err).message,
    })
  }
}

/**
 * Removes resources from a chat's JSONB resources column by type+id.
 */
export async function removeChatResources(chatId: string, toRemove: ChatResource[]): Promise<void> {
  if (toRemove.length === 0) return

  try {
    await serializeChatResourceWrite(chatId, async () => {
      await db.transaction(async (tx) => {
        const [chat] = await tx
          .select({ resources: copilotChats.resources })
          .from(copilotChats)
          .where(eq(copilotChats.id, chatId))
          .for('update')
          .limit(1)

        if (!chat) return

        const stored = Array.isArray(chat.resources) ? (chat.resources as ChatResource[]) : []
        const existing = sanitizeChatResources(stored)
        const removeKeys = new Set(sanitizeChatResources(toRemove).map((r) => `${r.type}:${r.id}`))
        const filtered = existing.filter((r) => !removeKeys.has(`${r.type}:${r.id}`))

        const removedSomething = filtered.length !== existing.length
        const sanitizedSomething = existing.length !== stored.length
        if (!removedSomething && !sanitizedSomething) return

        await tx
          .update(copilotChats)
          .set({ resources: sql`${JSON.stringify(filtered)}::jsonb` })
          .where(eq(copilotChats.id, chatId))
      })
    })
  } catch (err) {
    logger.warn('Failed to remove chat resources', {
      chatId,
      error: toError(err).message,
    })
  }
}
