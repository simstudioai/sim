import {
  ensureOrganizationAccountsContract,
  getOrganizationAccountsContract,
} from '@/lib/api/contracts/organization-accounts'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  ensureOrganizationAccounts,
  getOrganizationAccountsSettings,
  organizationAccountOperations,
} from '@/lib/credential-groups/application/organization-accounts'
import { createCredentialGroupInternalErrorPolicy } from '@/app/api/workspaces/[id]/credential-groups/error-policy'

const errorPolicy = createCredentialGroupInternalErrorPolicy(
  'Failed to load connected accounts',
  'Organization not found'
)
export const GET = defineInternalJsonRoute({
  contract: getOrganizationAccountsContract,
  auth: internalSessionAuth,
  operation: organizationAccountOperations.read,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated organization account metadata read',
  }),
  errorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: getOrganizationAccountsSettings,
})
export const POST = defineInternalJsonRoute({
  contract: ensureOrganizationAccountsContract,
  auth: internalSessionAuth,
  operation: organizationAccountOperations.ensure,
  rateLimit: internalRateLimits.none({
    reason: 'Idempotent administrator account-container setup',
  }),
  errorPolicy,
  mapInput: ({ params, body }) => ({ organizationId: params.id, ...body }),
  useCase: ensureOrganizationAccounts,
  present: ({ credentialGroup }) => ({ credentialGroup }),
})
