import { readRecallChatsContract } from '@/lib/api/contracts/mothership-chat-recall'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { internalCopilotAuth } from '@/lib/mothership/auth/internal'
import {
  RECALL_CHATS_AUDIENCE,
  readRecallChats,
  readRecallChatsOperation,
} from '@/lib/mothership/chat/application/read-recall-chats'

export const POST = defineInternalJsonRoute({
  contract: readRecallChatsContract,
  auth: internalCopilotAuth(RECALL_CHATS_AUDIENCE, { organization: true }),
  operation: readRecallChatsOperation,
  rateLimit: internalRateLimits.none({
    reason: "Authenticated worker lists the chat owner's other live chats it may read back.",
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: readRecallChats,
})
