import { changeStoredChatResources } from '@/lib/mothership/resources/store'
import { PERSISTED_RESOURCE_TYPES } from '@/lib/mothership/resources/types'
import type { StreamHandler } from './types'

/**
 * Commit worker resource effects before publication. The receipt and panel update
 * share a transaction, so recovery cannot repeat an effect over a user's later close.
 */
export const handleResourceEvent: StreamHandler = async (event, _context, execContext) => {
  if (event.type !== 'resource' || !event.payload.effectId || !execContext.chatId) return
  const { payload } = event
  if (payload.op === 'refresh') return
  if (payload.op === 'clear_view') {
    await changeStoredChatResources(
      execContext.chatId,
      { kind: 'clear-view', tableId: payload.resource.id, viewId: payload.resource.viewId },
      payload.effectId
    )
    return
  }
  const type = PERSISTED_RESOURCE_TYPES.find((type) => type === payload.resource.type)
  if (!type) throw new Error('Worker resource effect has an unsupported resource type')
  const resources = [{ ...payload.resource, type, title: payload.resource.title ?? '' }]
  await changeStoredChatResources(
    execContext.chatId,
    payload.op === 'remove' ? { kind: 'remove', resources } : { kind: 'upsert', resources },
    payload.effectId
  )
}
