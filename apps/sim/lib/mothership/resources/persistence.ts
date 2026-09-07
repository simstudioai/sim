import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { changeStoredChatResources } from '@/lib/mothership/resources/store'
import type { MothershipResource, MothershipResourceUpdate } from '@/lib/mothership/resources/types'

export {
  extractDeletedResourcesFromToolResult,
  extractResourcesFromToolResult,
  hasDeleteCapability,
  isResourceToolName,
} from '@/lib/mothership/resources/extraction'
export type {
  MothershipResource as ChatResource,
  MothershipResourceType as ResourceType,
} from '@/lib/mothership/resources/types'

const logger = createLogger('CopilotResources')

type ChatResource = MothershipResource

/**
 * Appends resources to a chat's JSONB resources column, deduplicating by type+id.
 * Updates the title of existing resources if the new title is more specific.
 */
export async function persistChatResources(
  chatId: string,
  newResources: MothershipResourceUpdate[]
): Promise<void> {
  if (newResources.length === 0) return
  try {
    await changeStoredChatResources(chatId, { kind: 'upsert', resources: newResources })
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
    await changeStoredChatResources(chatId, { kind: 'remove', resources: toRemove })
  } catch (err) {
    logger.warn('Failed to remove chat resources', {
      chatId,
      error: toError(err).message,
    })
  }
}
