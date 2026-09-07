import { deleteScimGroupMappingContract } from '@/lib/api/contracts/organization-scim'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { deleteScimGroupMapping } from '@/lib/scim/application/admin/manage-connection'

export const DELETE = defineInternalJsonRoute({
  contract: deleteScimGroupMappingContract,
  auth: internalSessionAuth,
  operation: deleteScimGroupMapping.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'scim-mapping-delete' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id, mappingId: params.mappingId }),
  useCase: deleteScimGroupMapping,
})
