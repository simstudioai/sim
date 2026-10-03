import { removeOrganizationDomainContract } from '@/lib/api/contracts/organization'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { removeOrganizationDomain } from '@/lib/organizations/application/domain-settings'

export const DELETE = defineInternalJsonRoute({
  contract: removeOrganizationDomainContract,
  operation: removeOrganizationDomain.operation,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.none({
    reason: 'Preserves existing organization domain management policy',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id, domainId: params.domainId }),
  useCase: removeOrganizationDomain,
  present: () => ({ success: true }),
})
