import {
  cancelGitHubSearchSetupContract,
  readGitHubSearchSetupContract,
  startGitHubSearchSetupContract,
} from '@/lib/api/contracts/knowledge/github-setup'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  cancelGitHubSearchSetup,
  readGitHubSearchSetup,
  startGitHubSearchSetup,
} from '@/lib/knowledge/application/github-setup'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

export const POST = defineInternalJsonRoute({
  contract: startGitHubSearchSetupContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.startGitHubSetup,
  rateLimit: internalRateLimits.user({ bucketName: 'github-search-setup' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: startGitHubSearchSetup,
  present: (result) => ({ success: true, ...result }),
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})

export const GET = defineInternalJsonRoute({
  contract: readGitHubSearchSetupContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.readGitHubSetup,
  rateLimit: internalRateLimits.user({ bucketName: 'github-search-setup-status' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ query }) => query,
  useCase: readGitHubSearchSetup,
  present: (data) => ({ success: true, data }),
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})

export const DELETE = defineInternalJsonRoute({
  contract: cancelGitHubSearchSetupContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.cancelGitHubSetup,
  rateLimit: internalRateLimits.user({ bucketName: 'github-search-setup' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: cancelGitHubSearchSetup,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
