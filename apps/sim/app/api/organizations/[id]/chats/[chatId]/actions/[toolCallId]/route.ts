import { decideAssistantActionContract } from '@/lib/api/contracts/assistant-actions'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { assistantActionOperations } from '@/lib/assistant-actions/application/operations'
import { decideOrganizationAssistantAction } from '@/lib/assistant-actions/application/review'

export const PATCH = defineInternalJsonRoute({
  contract: decideAssistantActionContract,
  auth: internalSessionAuth,
  operation: assistantActionOperations.decide,
  rateLimit: internalRateLimits.user({ bucketName: 'assistant-actions-decide' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({
    organizationId: params.id,
    chatId: params.chatId,
    toolCallId: params.toolCallId,
    ...body,
  }),
  useCase: decideOrganizationAssistantAction,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
