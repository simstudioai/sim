import {
  listScimGroupMappingsContract,
  upsertScimGroupMappingContract,
} from '@/lib/api/contracts/organization-scim'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  listScimGroupMappings,
  upsertScimGroupMapping,
} from '@/ee/scim/lib/application/admin/mappings'

/** What each directory group means inside Sim. */

export const GET = defineInternalJsonRoute({
  contract: listScimGroupMappingsContract,
  auth: internalSessionAuth,
  operation: listScimGroupMappings.operation,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated organization settings read, admission unchanged from its siblings.',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: listScimGroupMappings,
})

export const POST = defineInternalJsonRoute({
  contract: upsertScimGroupMappingContract,
  auth: internalSessionAuth,
  operation: upsertScimGroupMapping.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'scim-mapping-upsert' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ organizationId: params.id, ...body }),
  useCase: upsertScimGroupMapping,
})
