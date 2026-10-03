import { disconnectOAuthContract } from '@/lib/api/contracts/oauth-connections'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  credentialValidationParseOptions,
  internalCredentialErrorPolicy,
} from '@/lib/credentials/api/route-policies'
import { disconnectOAuthUseCase } from '@/lib/credentials/application/oauth-accounts'
import { credentialUserOperations } from '@/lib/credentials/application/operations'

export const dynamic = 'force-dynamic'

export const POST = defineInternalJsonRoute({
  contract: disconnectOAuthContract,
  auth: internalSessionAuth,
  operation: credentialUserOperations.disconnectOAuth,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal behavior' }),
  errorPolicy: internalCredentialErrorPolicy,
  parseOptions: credentialValidationParseOptions,
  mapInput: ({ body }) => body,
  useCase: disconnectOAuthUseCase,
  present: () => ({ success: true as const }),
})
