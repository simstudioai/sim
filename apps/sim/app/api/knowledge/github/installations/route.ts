import {
  connectGitHubSearchInstallationContract,
  listGitHubSearchInstallationsContract,
} from '@/lib/api/contracts/knowledge/github-installations'
import {
  defineInternalJsonRoute,
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { ManagedOAuthCredentialError } from '@/lib/credentials/managed-oauth'
import {
  connectGitHubSearchInstallation,
  listGitHubSearchInstallations,
} from '@/lib/knowledge/application/github-installations'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { GitHubInstallationError } from '@/lib/oauth/github-installation'

const errorPolicy = extendInternalErrorPolicy(internalOrchestrationErrorPolicy, (error) => {
  if (error instanceof GitHubInstallationError)
    return internalErrorResponse(error.status === 403 ? 403 : 502, { error: error.message })
  if (error instanceof ManagedOAuthCredentialError)
    return internalErrorResponse(error.statusCode, {
      error: 'Reconnect your GitHub account to continue installation setup',
    })
  return null
})

export const GET = defineInternalJsonRoute({
  contract: listGitHubSearchInstallationsContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.listGitHubInstallations,
  rateLimit: internalRateLimits.user({ bucketName: 'github-search-installations' }),
  errorPolicy,
  mapInput: ({ query }, { request }) => ({ ...query, signal: request.signal }),
  useCase: listGitHubSearchInstallations,
  present: (result) => ({ success: true, ...result }),
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})

export const POST = defineInternalJsonRoute({
  contract: connectGitHubSearchInstallationContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.connectGitHubInstallation,
  rateLimit: internalRateLimits.user({ bucketName: 'github-search-installations' }),
  errorPolicy,
  mapInput: ({ body }, { request }) => ({ ...body, signal: request.signal }),
  useCase: connectGitHubSearchInstallation,
  present: ({ credential }) => ({ success: true, credential }),
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
