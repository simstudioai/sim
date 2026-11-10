import { startOrganizationAccountConnectionContract } from '@/lib/api/contracts/organization-accounts'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { createCredentialGroupInternalErrorPolicy } from '@/lib/api/server/routes/credential-groups'
import {
  organizationAccountOperations,
  startOrganizationAccountConnection,
} from '@/lib/credential-groups/application/organization-accounts'

export const POST = defineInternalJsonRoute({
  contract: startOrganizationAccountConnectionContract,
  auth: internalSessionAuth,
  operation: organizationAccountOperations.connect,
  rateLimit: internalRateLimits.none({
    reason: 'Bounded current-member self-enrollment; no email delivery',
  }),
  errorPolicy: createCredentialGroupInternalErrorPolicy('Failed to connect account'),
  mapInput: ({ params, body }) => ({
    organizationId: params.id,
    ...body,
    ...(body.oauthCompletionId ? { returnTo: 'integrations' as const } : {}),
  }),
  useCase: startOrganizationAccountConnection,
})
