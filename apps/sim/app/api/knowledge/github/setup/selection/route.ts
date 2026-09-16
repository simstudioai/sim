import { selectGitHubSearchSetupContract } from '@/lib/api/contracts/knowledge/github-setup'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { selectGitHubSearchSetup } from '@/lib/knowledge/application/github-setup'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

export const POST = defineInternalJsonRoute({
  contract: selectGitHubSearchSetupContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.selectGitHubSetup,
  rateLimit: internalRateLimits.user({ bucketName: 'github-search-setup' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: selectGitHubSearchSetup,
  present: (result) => ({ success: true, ...result }),
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
