import { copilotChatDismissSteeringContract } from '@/lib/api/contracts/copilot'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { dismissSteeringMessage } from '@/lib/mothership/chat/application/steering-fallback'

/** Drops a steering message the user gave up on, under the chat owner's current access. */
export const POST = defineInternalJsonRoute({
  contract: copilotChatDismissSteeringContract,
  auth: internalSessionAuth,
  operation: dismissSteeringMessage.operation,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated cleanup of one message the user already sent; it starts no work.',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => ({ chatId: body.chatId, messageId: body.steeringId }),
  useCase: dismissSteeringMessage,
})
