import { getOrganizationHomeWorkspaceActivityContract } from '@/lib/api/contracts/organization-home'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  organizationHomeWorkspaceOperations,
  readOrganizationHomeWorkspaceActivity,
} from '@/lib/organizations/application/home-workspaces'
import { createCredentialGroupInternalErrorPolicy } from '@/app/api/workspaces/[id]/credential-groups/error-policy'

export const GET = defineInternalJsonRoute({
  contract: getOrganizationHomeWorkspaceActivityContract,
  auth: internalSessionAuth,
  operation: organizationHomeWorkspaceOperations.readActivity,
  rateLimit: internalRateLimits.user({ bucketName: 'organization-home-workspace-activity' }),
  errorPolicy: createCredentialGroupInternalErrorPolicy(
    'Failed to load workspace activity',
    'Organization not found'
  ),
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: readOrganizationHomeWorkspaceActivity,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
