import { getMothershipChatStreamStatusContract } from '@/lib/api/contracts/mothership-chats'
import {
  defineInternalJsonRoute,
  internalJsonPresenters,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { readChatStreamStatus } from '@/lib/mothership/chat/application/read-stream-status'

/** Whether the owner's chat is still streaming, read without its transcript. */
export const GET = defineInternalJsonRoute({
  contract: getMothershipChatStreamStatusContract,
  operation: readChatStreamStatus.operation,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.none({
    reason: 'Replaces full chat detail reads, which have no separate rate bucket.',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ chatId: params.chatId }),
  useCase: readChatStreamStatus,
  present: internalJsonPresenters.withSuccess,
})
