import { listConnectedAccountsContract } from '@/lib/api/contracts/oauth-connections'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  credentialValidationParseOptions,
  internalCredentialErrorPolicy,
} from '@/lib/credentials/api/route-policies'
import { listConnectedAccountsUseCase } from '@/lib/credentials/application/oauth-accounts'
import { credentialUserOperations } from '@/lib/credentials/application/operations'

export const GET = defineInternalJsonRoute({
  contract: listConnectedAccountsContract,
  auth: internalSessionAuth,
  operation: credentialUserOperations.listConnectedAccounts,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal behavior' }),
  errorPolicy: internalCredentialErrorPolicy,
  parseOptions: credentialValidationParseOptions,
  mapInput: ({ query }) => query,
  useCase: listConnectedAccountsUseCase,
})
