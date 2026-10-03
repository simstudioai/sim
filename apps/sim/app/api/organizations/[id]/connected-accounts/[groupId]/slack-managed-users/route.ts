import { startOrganizationSlackConfigurationContract } from '@/lib/api/contracts/organization-accounts'
import {
  defineInternalJsonRoute,
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import { startSlackCredentialGroupConfiguration } from '@/lib/credential-groups/application/slack-managed-users'
import { SlackManagedUsersError } from '@/lib/credential-groups/slack-managed-users'
import { createCredentialGroupInternalErrorPolicy } from '@/app/api/workspaces/[id]/credential-groups/error-policy'

export const POST = defineInternalJsonRoute({
  contract: startOrganizationSlackConfigurationContract,
  auth: internalSessionAuth,
  operation: credentialGroupOperations.startSlackConfiguration,
  rateLimit: internalRateLimits.none({
    reason: 'Slack applies provider authorization limits and setup requires an organization admin',
  }),
  errorPolicy: extendInternalErrorPolicy(
    createCredentialGroupInternalErrorPolicy('Failed to configure Slack'),
    (error) =>
      error instanceof SlackManagedUsersError
        ? internalErrorResponse(400, { error: error.message })
        : null
  ),
  mapInput: ({ params, body }) => ({
    ...body,
    organizationId: params.id,
    credentialGroupId: params.groupId,
  }),
  useCase: startSlackCredentialGroupConfiguration,
})
