import { updateOrganizationAccountsContract } from '@/lib/api/contracts/organization-accounts'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { createCredentialGroupInternalErrorPolicy } from '@/lib/api/server/routes/credential-groups'
import {
  organizationAccountOperations,
  updateOrganizationAccountsSettings,
} from '@/lib/credential-groups/application/organization-accounts'

export const PATCH = defineInternalJsonRoute({
  contract: updateOrganizationAccountsContract,
  auth: internalSessionAuth,
  operation: organizationAccountOperations.update,
  rateLimit: internalRateLimits.none({ reason: 'Administrator account configuration mutation' }),
  errorPolicy: createCredentialGroupInternalErrorPolicy('Failed to update connected accounts'),
  mapInput: ({ params, body }) => ({
    organizationId: params.id,
    credentialGroupId: params.groupId,
    update: body,
  }),
  useCase: updateOrganizationAccountsSettings,
})
