import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, sql } from 'drizzle-orm'
import { isEphemeralResource } from '@/lib/copilot/resource-extraction'
import type { MothershipResource } from '@/lib/copilot/resource-types'

export {
  extractDeletedResourcesFromToolResult,
  extractResourcesFromToolResult,
  hasDeleteCapability,
  isEphemeralResource,
  isResourceToolName,
} from '@/lib/copilot/resource-extraction'
export type {
  MothershipResource as ChatResource,
  MothershipResourceType as ResourceType,
} from '@/lib/copilot/resource-types'

const logger = createLogger('CopilotResources')

/**
 * Appends resources to a chat's JSONB resources column, deduplicating by type+id.
 * Updates the title of existing resources if the new title is more specific.
 */
export async function persistChatResources(
  chatId: string,
  newResources: MothershipResource[]
): Promise<void> {
  const toMerge = newResources.filter((r) => !isEphemeralResource(r))
  if (toMerge.length === 0) return

  try {
    const [chat] = await db
      .select({ resources: copilotChats.resources })
      .from(copilotChats)
      .where(eq(copilotChats.id, chatId))
      .limit(1)

    if (!chat) return

    const existing = Array.isArray(chat.resources) ? (chat.resources as MothershipResource[]) : []
    const map = new Map<string, MothershipResource>()
    const GENERIC = new Set(['Table', 'File', 'Workflow', 'Knowledge Base', 'Folder'])

    for (const r of existing) {
      map.set(`${r.type}:${r.id}`, r)
    }

    for (const r of toMerge) {
      const key = `${r.type}:${r.id}`
      const prev = map.get(key)
      if (!prev || (GENERIC.has(prev.title) && !GENERIC.has(r.title))) {
        map.set(key, r)
      }
    }

    const merged = Array.from(map.values())

    await db
      .update(copilotChats)
      .set({ resources: sql`${JSON.stringify(merged)}::jsonb` })
      .where(eq(copilotChats.id, chatId))
  } catch (err) {
    logger.warn('Failed to persist chat resources', {
      chatId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Removes resources from a chat's JSONB resources column by type+id.
 */
export async function removeChatResources(
  chatId: string,
  toRemove: MothershipResource[]
): Promise<void> {
  if (toRemove.length === 0) return

  try {
    const [chat] = await db
      .select({ resources: copilotChats.resources })
      .from(copilotChats)
      .where(eq(copilotChats.id, chatId))
      .limit(1)

    if (!chat) return

    const existing = Array.isArray(chat.resources) ? (chat.resources as MothershipResource[]) : []
    const removeKeys = new Set(toRemove.map((r) => `${r.type}:${r.id}`))
    const filtered = existing.filter((r) => !removeKeys.has(`${r.type}:${r.id}`))

    if (filtered.length === existing.length) return

    await db
      .update(copilotChats)
      .set({ resources: sql`${JSON.stringify(filtered)}::jsonb` })
      .where(eq(copilotChats.id, chatId))
  } catch (err) {
    logger.warn('Failed to remove chat resources', {
      chatId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
