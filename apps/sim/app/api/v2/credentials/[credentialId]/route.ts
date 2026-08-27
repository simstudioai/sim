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
import {
  CredentialProviderOperationError,
  updateWorkspaceCredentialUseCase,
} from '@/lib/credentials/application/credential-crud'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { toV2Credential } from '@/lib/credentials/application/presentation'
import { deleteCredentialUseCase } from '@/lib/credentials/application/service-account'
import { v2CaughtOrchestrationError, v2Error } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Separates a provider rejecting the submitted secret from the provider being
 * unreachable while it is verified.
 *
 * `CredentialProviderOperationError` extends `OrchestrationError('validation')`,
 * so the default projection renders both as `400`. That tells a caller whose
 * provider is merely down that its secret material is permanently wrong, which
 * invites it to revoke a credential that is fine. `503` says the opposite, and
 * `v2Error` attaches `Retry-After` from its status table. The outage message is
 * deliberately generic — the underlying value is a provider transport failure,
 * not anything the caller submitted — while a genuine rejection keeps the
 * provider's own code in `details.providerErrorCode` so a client can map it.
 */
function renderCredentialProviderError(error: unknown) {
  if (!(error instanceof CredentialProviderOperationError)) return null
  return error.providerUnavailable
    ? v2Error('SERVICE_UNAVAILABLE', 'Credential provider is temporarily unavailable')
    : v2Error('BAD_REQUEST', error.message, {
        details: { providerErrorCode: error.providerErrorCode },
      })
}

const credentialErrorPolicy = createV2ResourceConcealmentPolicy({
  notFoundMessage: 'Credential not found',
  render: (error) => renderCredentialProviderError(error) ?? v2CaughtOrchestrationError(error),
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
