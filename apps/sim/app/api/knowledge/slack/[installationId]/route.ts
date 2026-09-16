import { removeSlackSearchContract } from '@/lib/api/contracts/knowledge/slack'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { removeSlackSearchInstallation } from '@/lib/knowledge/application/slack-search/installations'

export const DELETE = defineInternalJsonRoute({
  contract: removeSlackSearchContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.removeSlackInstallation,
  rateLimit: internalRateLimits.user({ bucketName: 'slack-search-settings' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ query, params }) => ({ ...query, ...params }),
  useCase: removeSlackSearchInstallation,
  present: (result) => result,
})
