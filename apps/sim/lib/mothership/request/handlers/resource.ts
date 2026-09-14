import { persistResourceEffect } from '@/lib/mothership/resources/persist-effect'
import type { StreamHandler } from './types'

/**
 * Commit worker resource effects before publication. The receipt and panel update
 * share a transaction, so recovery cannot repeat an effect over a user's later close.
 */
export const handleResourceEvent: StreamHandler = async (event, _context, execContext) => {
  if (event.type !== 'resource' || !event.payload.effectId || !execContext.chatId) return
  await persistResourceEffect(execContext.chatId, event.payload)
}
