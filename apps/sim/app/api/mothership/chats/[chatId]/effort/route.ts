import { setMothershipChatEffortContract } from '@/lib/api/contracts/mothership-chats'
import {
  defineInternalJsonRoute,
  internalJsonPresenters,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { setChatEffort } from '@/lib/mothership/chat/application/set-effort'

/** Records the reasoning effort the owner picked for one of their chats. */
export const PUT = defineInternalJsonRoute({
  contract: setMothershipChatEffortContract,
  operation: setChatEffort.operation,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.none({
    reason: 'Personal chat settings updates have no separate rate bucket.',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ chatId: params.chatId, effort: body.effort }),
  useCase: setChatEffort,
  present: internalJsonPresenters.withSuccess,
})
