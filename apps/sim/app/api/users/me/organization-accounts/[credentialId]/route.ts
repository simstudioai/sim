import { disconnectPersonalOrganizationAccountContract } from '@/lib/api/contracts/organization-accounts'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { disconnectPersonalOrganizationAccount } from '@/lib/credential-groups/application/personal-organization-accounts'

export const DELETE = defineInternalJsonRoute({
  contract: disconnectPersonalOrganizationAccountContract,
  auth: internalSessionAuth,
  operation: disconnectPersonalOrganizationAccount.operation,
  rateLimit: internalRateLimits.none({ reason: 'Current-user connected account management' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: disconnectPersonalOrganizationAccount,
  present: () => ({ success: true as const }),
})
