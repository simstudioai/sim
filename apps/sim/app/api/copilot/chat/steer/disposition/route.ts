import { copilotChatReadSteeringContract } from '@/lib/api/contracts/copilot'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { readSteeringMessage } from '@/lib/mothership/chat/application/steering-fallback'

/** Reads what became of a steering message, under the chat owner's current access, without sending it. */
export const POST = defineInternalJsonRoute({
  contract: copilotChatReadSteeringContract,
  auth: internalSessionAuth,
  operation: readSteeringMessage.operation,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated read of one message the user already sent; it starts no work.',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => ({ chatId: body.chatId, messageId: body.steeringId }),
  useCase: readSteeringMessage,
})
