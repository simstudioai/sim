import { v2ListCredentialProvidersContract } from '@/lib/api/contracts/v2/credentials'
import {
  createV2ResourceConcealmentPolicy,
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { listCredentialProviders } from '@/lib/credentials/application/list-credential-providers'
import { credentialOperations } from '@/lib/credentials/application/operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const credentialProviderErrorPolicy = createV2ResourceConcealmentPolicy({
  notFoundMessage: 'Workspace not found',
})

export const GET = defineV2JsonRoute({
  contract: v2ListCredentialProvidersContract,
  auth: v2ApiKeyAuth,
  operation: credentialOperations.listProviders,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: credentialProviderErrorPolicy,
  mapInput: ({ query }) => query,
  useCase: listCredentialProviders,
  present: ({ providers }) => ({ data: providers, nextCursor: null }),
})
