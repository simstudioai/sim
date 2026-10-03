import {
  configureScimConnectionContract,
  getScimConnectionContract,
} from '@/lib/api/contracts/organization-scim'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  configureScimConnection,
  getScimConnection,
} from '@/ee/scim/lib/application/admin/connection'

/**
 * The organization's directory-provisioning connection.
 *
 * Session-authenticated settings surface, distinct from the SCIM protocol
 * endpoints under `/api/scim/v2` that the identity provider itself calls.
 */

export const GET = defineInternalJsonRoute({
  contract: getScimConnectionContract,
  auth: internalSessionAuth,
  operation: getScimConnection.operation,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated organization settings read, admission unchanged from its siblings.',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: getScimConnection,
})

export const PUT = defineInternalJsonRoute({
  contract: configureScimConnectionContract,
  auth: internalSessionAuth,
  operation: configureScimConnection.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'scim-configure' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({
    organizationId: params.id,
    ...(body.status !== undefined ? { status: body.status } : {}),
    ...(body.settings !== undefined ? { settings: body.settings } : {}),
  }),
  useCase: configureScimConnection,
  present: ({ connection }) => ({ connection }),
})
