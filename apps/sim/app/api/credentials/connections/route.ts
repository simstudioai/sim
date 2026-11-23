import { startCredentialConnectionContract } from '@/lib/api/contracts/credentials'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalCredentialErrorPolicy } from '@/lib/credentials/api/route-policies'
import { createCredentialConnection } from '@/lib/credentials/application/create-credential-connection'
import { credentialOperations } from '@/lib/credentials/application/operations'

export const POST = defineInternalJsonRoute({
  contract: startCredentialConnectionContract,
  auth: internalSessionAuth,
  operation: credentialOperations.createConnection,
  rateLimit: internalRateLimits.user({ bucketName: 'credentials.connections.start' }),
  errorPolicy: internalCredentialErrorPolicy,
  mapInput: ({ body: { workspaceId, providerId, credentialId } }) =>
    credentialId
      ? { workspaceId, credentialId, assertedProviderId: providerId }
      : { workspaceId, providerId },
  useCase: createCredentialConnection,
  present: ({ authorizationUrl }) => ({ authorizationUrl }),
})
