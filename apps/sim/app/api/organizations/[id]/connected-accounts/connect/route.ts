import { startOrganizationAccountConnectionContract } from '@/lib/api/contracts/organization-accounts'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  organizationAccountOperations,
  startOrganizationAccountConnection,
} from '@/lib/credential-groups/application/organization-accounts'
import { createCredentialGroupInternalErrorPolicy } from '@/app/api/workspaces/[id]/credential-groups/error-policy'

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
    optionId: body.optionId,
  }),
  useCase: startOrganizationAccountConnection,
})
