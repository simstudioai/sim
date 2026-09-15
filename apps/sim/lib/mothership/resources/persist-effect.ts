import type { ResourcePayload } from '@/lib/mothership/generated/resources'
import { changeStoredChatResources } from '@/lib/mothership/resources/store'
import { PERSISTED_RESOURCE_TYPES } from '@/lib/mothership/resources/types'

/** Commit the effect receipt with the panel update before its owning stream publishes it. */
export async function persistResourceEffect(
  chatId: string,
  payload: ResourcePayload
): Promise<void> {
  if (!payload.effectId || payload.op === 'refresh') return
  if (payload.op === 'clear_view') {
    await changeStoredChatResources(
      chatId,
      {
        kind: 'clear-view',
        tableId: payload.resource.id,
        viewId: payload.resource.viewId,
        workspaceId: payload.resource.workspaceId,
      },
      payload.effectId
    )
    return
  }
  const type = PERSISTED_RESOURCE_TYPES.find((type) => type === payload.resource.type)
  if (!type) throw new Error('Resource effect has an unsupported resource type')
  const resources = [{ ...payload.resource, type, title: payload.resource.title ?? '' }]
  await changeStoredChatResources(
    chatId,
    payload.op === 'remove' ? { kind: 'remove', resources } : { kind: 'upsert', resources },
    payload.effectId
  )
}
