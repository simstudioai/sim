import { defineRouteContract } from '@/lib/api/contracts/types'
import { RecallChatsRequest, RecallChatsResponse } from '@/lib/mothership/generated/chat-recall'

export const readRecallChatsContract = defineRouteContract({
  method: 'POST',
  path: '/api/mothership/chats/recall',
  body: RecallChatsRequest,
  response: { mode: 'json', schema: RecallChatsResponse },
})
