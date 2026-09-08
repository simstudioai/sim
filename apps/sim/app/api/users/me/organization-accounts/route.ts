import { listPersonalOrganizationAccountsContract } from '@/lib/api/contracts/organization-accounts'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { listPersonalOrganizationAccounts } from '@/lib/credential-groups/application/personal-organization-accounts'

export const GET = defineInternalJsonRoute({
  contract: listPersonalOrganizationAccountsContract,
  auth: internalSessionAuth,
  operation: listPersonalOrganizationAccounts.operation,
  rateLimit: internalRateLimits.none({ reason: 'Current-user connected account management' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ query }) => query,
  useCase: listPersonalOrganizationAccounts,
})
