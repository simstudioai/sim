import {
  listPersonalSourceSetupAccountsContract,
  personalSourceSetupContract,
} from '@/lib/api/contracts/knowledge/personal-source-setup'
import {
  defineInternalJsonRoute,
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  listPersonalSourceSetupAccounts,
  personalSourceSetup,
} from '@/lib/knowledge/application/personal-source-setup'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { IntegrationNotAllowedError } from '@/ee/access-control/utils/permission-check'

const errorPolicy = extendInternalErrorPolicy(
  internalKnowledgeErrorPolicies.connectAccount,
  (error) => {
    if (error instanceof SelectorConnectionUnavailableError)
      return internalErrorResponse(error.status, {
        error: 'Reconnect your account to choose projects or spaces',
      })
    if (error instanceof SelectorContextUnavailableError)
      return internalErrorResponse(400, {
        error: 'Enter your Atlassian site to choose projects or spaces',
      })
    if (error instanceof SelectorOptionsUnavailableError)
      return internalErrorResponse(error.status, {
        error:
          'Could not load projects or spaces. Check the site and account access, then try again.',
      })
    if (error instanceof IntegrationNotAllowedError)
      return internalErrorResponse(403, { error: error.message })
    return null
  }
)

export const GET = defineInternalJsonRoute({
  contract: listPersonalSourceSetupAccountsContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.listPersonalSourceSetupAccounts,
  rateLimit: internalRateLimits.user({ bucketName: 'knowledge.search.personal-setup.accounts' }),
  errorPolicy,
  mapInput: ({ query }) => query,
  useCase: listPersonalSourceSetupAccounts,
  present: (data) => ({ success: true as const, data }),
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})

export const POST = defineInternalJsonRoute({
  contract: personalSourceSetupContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.personalSourceSetup,
  rateLimit: internalRateLimits.user({ bucketName: 'knowledge.search.personal-setup' }),
  errorPolicy,
  parseOptions: { maxBodyBytes: 384 * 1024 },
  mapInput: ({ body }) => body,
  useCase: personalSourceSetup,
  present: (data) => ({ success: true as const, data }),
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
