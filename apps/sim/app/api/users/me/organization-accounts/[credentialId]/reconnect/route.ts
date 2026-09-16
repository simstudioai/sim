import { reconnectPersonalOrganizationAccountContract } from '@/lib/api/contracts/organization-accounts'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { reconnectPersonalOrganizationAccount } from '@/lib/credential-groups/application/personal-organization-accounts'

export const POST = defineInternalJsonRoute({
  contract: reconnectPersonalOrganizationAccountContract,
  auth: internalSessionAuth,
  operation: reconnectPersonalOrganizationAccount.operation,
  rateLimit: internalRateLimits.none({ reason: 'Current-user connected account management' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: reconnectPersonalOrganizationAccount,
})
