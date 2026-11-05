import { getOrganizationHomeEmailContract } from '@/lib/api/contracts/organization-home'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  organizationHomeOperations,
  readOrganizationHomeEmail,
} from '@/lib/organizations/application/home-widgets'
import { createCredentialGroupInternalErrorPolicy } from '@/app/api/workspaces/[id]/credential-groups/error-policy'

export const GET = defineInternalJsonRoute({
  contract: getOrganizationHomeEmailContract,
  auth: internalSessionAuth,
  operation: organizationHomeOperations.readEmail,
  rateLimit: internalRateLimits.user({ bucketName: 'organization-home-email' }),
  errorPolicy: createCredentialGroupInternalErrorPolicy(
    'Failed to load email',
    'Organization not found'
  ),
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: readOrganizationHomeEmail,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
