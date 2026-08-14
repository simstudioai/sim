import { listOAuthConnectionsContract } from '@/lib/api/contracts/oauth-connections'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalCredentialErrorPolicy } from '@/lib/credentials/api/route-policies'
import { listOAuthConnectionsUseCase } from '@/lib/credentials/application/oauth-accounts'
import { credentialUserOperations } from '@/lib/credentials/application/operations'

export const GET = defineInternalJsonRoute({
  contract: listOAuthConnectionsContract,
  auth: internalSessionAuth,
  operation: credentialUserOperations.listOAuthConnections,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal behavior' }),
  errorPolicy: internalCredentialErrorPolicy,
  mapInput: () => ({}),
  useCase: listOAuthConnectionsUseCase,
})
