import { getWorkspaceOrganizationAccountsContract } from '@/lib/api/contracts/organization-accounts'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getWorkspaceOrganizationAccounts } from '@/lib/credential-groups/application/workspace-organization-accounts'

export const GET = defineInternalJsonRoute({
  contract: getWorkspaceOrganizationAccountsContract,
  auth: internalSessionAuth,
  operation: getWorkspaceOrganizationAccounts.operation,
  rateLimit: internalRateLimits.none({ reason: 'Read-only workspace organization account status' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.id }),
  useCase: getWorkspaceOrganizationAccounts,
})
