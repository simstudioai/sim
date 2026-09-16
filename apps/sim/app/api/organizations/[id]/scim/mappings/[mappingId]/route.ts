import { deleteScimGroupMappingContract } from '@/lib/api/contracts/organization-scim'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { deleteScimGroupMapping } from '@/ee/scim/lib/application/admin/mappings'

export const DELETE = defineInternalJsonRoute({
  contract: deleteScimGroupMappingContract,
  auth: internalSessionAuth,
  operation: deleteScimGroupMapping.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'scim-mapping-delete' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id, mappingId: params.mappingId }),
  useCase: deleteScimGroupMapping,
  present: ({ success, reconciledUsers }) => ({ success, reconciledUsers }),
})
