import { v2DeleteCredentialContract } from '@/lib/api/contracts/v2/credentials'
import {
  createV2ResourceConcealmentPolicy,
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { deleteCredentialUseCase } from '@/lib/credentials/application/service-account'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const credentialErrorPolicy = createV2ResourceConcealmentPolicy({
  notFoundMessage: 'Credential not found',
})

export const DELETE = defineV2JsonRoute({
  contract: v2DeleteCredentialContract,
  auth: v2ApiKeyAuth,
  operation: credentialOperations.delete,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: credentialErrorPolicy,
  mapInput: ({ params, query }) => ({
    workspaceId: query.workspaceId,
    credentialId: params.credentialId,
  }),
  useCase: deleteCredentialUseCase,
  present: ({ credential }) => ({ data: { id: credential.id, deleted: true as const } }),
})
