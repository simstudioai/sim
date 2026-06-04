import { MothershipStreamV1SessionKind } from '@/lib/copilot/generated/mothership-stream-v1'
import type { StreamHandler } from './types'

export const handleSessionEvent: StreamHandler = (event, context, execContext) => {
  if (event.type !== 'session' || event.payload.kind !== MothershipStreamV1SessionKind.chat) {
    return
  }

  const chatId = event.payload.chatId
  context.chatId = chatId
  if (chatId) {
    execContext.chatId = chatId
  }
}
