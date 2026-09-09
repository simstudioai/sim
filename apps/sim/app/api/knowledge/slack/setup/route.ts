import { prepareSlackSearchContract } from '@/lib/api/contracts/knowledge/slack'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { prepareSlackSearchSetup } from '@/lib/knowledge/application/slack-search/setup'

export const POST = defineInternalJsonRoute({
  contract: prepareSlackSearchContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.prepareSlackInstallation,
  rateLimit: internalRateLimits.user({ bucketName: 'slack-search-settings' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: prepareSlackSearchSetup,
})
