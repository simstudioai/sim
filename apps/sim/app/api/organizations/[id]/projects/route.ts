import { listOrganizationProjectsContract } from '@/lib/api/contracts/projects'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalPermissionGroupErrorPolicy } from '@/lib/api/server/routes/permission-groups'
import {
  listOrganizationProjects,
  listOrganizationProjectsOperation,
} from '@/lib/projects/application/organization-projects'

export const GET = defineInternalJsonRoute({
  contract: listOrganizationProjectsContract,
  auth: internalSessionAuth,
  operation: listOrganizationProjectsOperation,
  rateLimit: internalRateLimits.none({
    reason:
      'Read-only organization settings inventory follows existing workspace inventory admission',
  }),
  errorPolicy: internalPermissionGroupErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: listOrganizationProjects,
  present: (result) => result,
})
