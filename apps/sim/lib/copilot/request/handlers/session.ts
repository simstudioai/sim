import { MothershipStreamV1SessionKind } from '@/lib/copilot/generated/mothership-stream-v1'
import { getEventData } from '@/lib/copilot/request/sse-utils'
import type { StreamHandler } from './types'

export const handleSessionEvent: StreamHandler = (event, context, execContext) => {
  const data = getEventData(event)
  if (data?.kind === MothershipStreamV1SessionKind.chat) {
    const chatId = data.chatId as string | undefined
    context.chatId = chatId
    if (chatId) {
      execContext.chatId = chatId
    }
  }
}
