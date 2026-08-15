import { v2CreateCredentialConnectionContract } from '@/lib/api/contracts/v2/credentials'
import {
  createV2ResourceConcealmentPolicy,
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { createCredentialConnection } from '@/lib/credentials/application/create-credential-connection'
import { credentialOperations } from '@/lib/credentials/application/operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const credentialConnectionErrorPolicy = createV2ResourceConcealmentPolicy({
  notFoundMessage: 'Workspace not found',
})

export const POST = defineV2JsonRoute({
  contract: v2CreateCredentialConnectionContract,
  auth: v2ApiKeyAuth,
  operation: credentialOperations.createConnection,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: credentialConnectionErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: createCredentialConnection,
  present: ({ authorizationUrl, expiresAt }) => ({
    data: {
      authorizationUrl,
      expiresAt: expiresAt.toISOString(),
    },
  }),
})
