import { getOrganizationHomeWorkspaceActivityContract } from '@/lib/api/contracts/organization-home'
import {
  createInternalResourceConcealmentPolicy,
  defineInternalJsonRoute,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  organizationHomeWorkspaceOperations,
  readOrganizationHomeWorkspaceActivity,
} from '@/lib/organizations/application/home-workspaces'

export const GET = defineInternalJsonRoute({
  contract: getOrganizationHomeWorkspaceActivityContract,
  auth: internalSessionAuth,
  operation: organizationHomeWorkspaceOperations.readActivity,
  rateLimit: internalRateLimits.user({ bucketName: 'organization-home-workspace-activity' }),
  errorPolicy: createInternalResourceConcealmentPolicy({
    base: {
      project: internalOrchestrationErrorPolicy.project,
      unhandled: () => internalErrorResponse(500, { error: 'Failed to load workspace activity' }),
    },
    notFoundMessage: 'Organization not found',
  }),
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: readOrganizationHomeWorkspaceActivity,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
