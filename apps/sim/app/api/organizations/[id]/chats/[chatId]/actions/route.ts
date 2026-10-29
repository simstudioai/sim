import { listAssistantActionsContract } from '@/lib/api/contracts/assistant-actions'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { assistantActionOperations } from '@/lib/assistant-actions/application/operations'
import { listOrganizationAssistantActions } from '@/lib/assistant-actions/application/review'

export const GET = defineInternalJsonRoute({
  contract: listAssistantActionsContract,
  auth: internalSessionAuth,
  operation: assistantActionOperations.list,
  rateLimit: internalRateLimits.user({
    bucketName: 'assistant-actions-review',
    config: { maxTokens: 120, refillRate: 120, refillIntervalMs: 60_000 },
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({
    organizationId: params.id,
    chatId: params.chatId,
    cursor: query.cursor,
  }),
  useCase: listOrganizationAssistantActions,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
