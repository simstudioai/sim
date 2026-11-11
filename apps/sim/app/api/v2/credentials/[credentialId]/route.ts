import {
  v2DeleteCredentialContract,
  v2UpdateCredentialContract,
} from '@/lib/api/contracts/v2/credentials'
import {
  createV2ResourceConcealmentPolicy,
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { renderV2CredentialProviderError } from '@/lib/credentials/api/route-policies'
import { updateWorkspaceCredentialUseCase } from '@/lib/credentials/application/crud'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { toV2Credential } from '@/lib/credentials/application/presentation'
import { deleteCredentialUseCase } from '@/lib/credentials/application/service-account'
import { v2CaughtOrchestrationError } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const credentialErrorPolicy = createV2ResourceConcealmentPolicy({
  notFoundMessage: 'Credential not found',
  render: (error) => renderV2CredentialProviderError(error) ?? v2CaughtOrchestrationError(error),
})

/**
 * PATCH /api/v2/credentials/[credentialId] — Rotate secret material or rename.
 *
 * The credential ID is preserved, so every workflow block, deployment, paused
 * run, knowledge connector, and webhook already referencing it keeps working —
 * which delete-and-recreate, the only rotation path before this route, does not.
 */
export const PATCH = defineV2JsonRoute({
  contract: v2UpdateCredentialContract,
  auth: v2ApiKeyAuth,
  operation: credentialOperations.update,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: credentialErrorPolicy,
  mapInput: ({ params, query, body }) => ({
    ...body,
    credentialId: params.credentialId,
    assertedWorkspaceId: query.workspaceId,
  }),
  useCase: updateWorkspaceCredentialUseCase,
  present: ({ credential, access }) => ({
    data: toV2Credential({
      ...credential,
      hasServiceAccountKey: Boolean(credential.encryptedServiceAccountKey),
      role: access.isAdmin ? 'admin' : 'member',
    }),
  }),
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
