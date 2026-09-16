import { startSlackCredentialGroupConfigurationContract } from '@/lib/api/contracts/credential-groups'
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

const errorPolicy = extendInternalErrorPolicy(
  createCredentialGroupInternalErrorPolicy('Failed to configure Slack for Credential Group'),
  (error) =>
    error instanceof SlackManagedUsersError
      ? internalErrorResponse(400, { error: error.message })
      : null
)

export const POST = defineInternalJsonRoute({
  contract: startSlackCredentialGroupConfigurationContract,
  auth: internalSessionAuth,
  operation: credentialGroupOperations.startSlackConfiguration,
  rateLimit: internalRateLimits.none({
    reason: 'Slack applies provider authorization limits and setup requires a workspace admin',
  }),
  errorPolicy,
  mapInput: ({ params, body }) => ({
    assertedWorkspaceId: params.id,
    credentialGroupId: params.groupId,
    slackBotCredentialId: body.slackBotCredentialId,
    clientId: body.clientId,
    clientSecret: body.clientSecret,
    requiredScopes: body.requiredScopes,
  }),
  useCase: startSlackCredentialGroupConfiguration,
})
