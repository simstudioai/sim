import { listAssistantActionReceiptsContract } from '@/lib/api/contracts/assistant-actions'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { assistantActionOperations } from '@/lib/assistant-actions/application/operations'
import { listOrganizationAssistantActionReceipts } from '@/lib/assistant-actions/application/receipts'

export const GET = defineInternalJsonRoute({
  contract: listAssistantActionReceiptsContract,
  auth: internalSessionAuth,
  operation: assistantActionOperations.receipts,
  rateLimit: internalRateLimits.user({
    bucketName: 'assistant-action-receipts',
    config: { maxTokens: 120, refillRate: 120, refillIntervalMs: 60_000 },
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({ organizationId: params.id, chatId: params.chatId, ...query }),
  useCase: listOrganizationAssistantActionReceipts,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
