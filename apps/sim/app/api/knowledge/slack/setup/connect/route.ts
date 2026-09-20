import { connectCustomSlackSearchContract } from '@/lib/api/contracts/knowledge/slack'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { connectCustomSlackSearch } from '@/lib/knowledge/application/slack-search/setup'

export const POST = defineInternalJsonRoute({
  contract: connectCustomSlackSearchContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.connectCustomSlackInstallation,
  rateLimit: internalRateLimits.user({ bucketName: 'slack-search-settings' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: connectCustomSlackSearch,
})
