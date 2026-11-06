import { listMothershipChatOlderMessagesContract } from '@/lib/api/contracts/mothership-chats'
import {
  defineInternalJsonRoute,
  internalJsonPresenters,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { readChatOlderMessages } from '@/lib/mothership/chat/application/read-older-messages'

/** Older messages of the owner's chat, which the chat page loads behind its newest window. */
export const GET = defineInternalJsonRoute({
  contract: listMothershipChatOlderMessagesContract,
  operation: readChatOlderMessages.operation,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.none({
    reason:
      'Pages a transcript the chat detail read used to return whole, which has no separate rate bucket.',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({ chatId: params.chatId, before: query.before }),
  useCase: readChatOlderMessages,
  present: internalJsonPresenters.withSuccess,
})
