import { verifyOrganizationDomainContract } from '@/lib/api/contracts/organization'
import {
  defineInternalJsonRoute,
  extendInternalErrorPolicy,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { toDomainResponse } from '@/lib/auth/sso/domain-verification'
import {
  DomainVerificationLookupError,
  verifyOrganizationDomain,
} from '@/lib/organizations/application/domain-settings'

export const POST = defineInternalJsonRoute({
  contract: verifyOrganizationDomainContract,
  operation: verifyOrganizationDomain.operation,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.none({
    reason: 'Preserves existing organization domain management policy',
  }),
  errorPolicy: extendInternalErrorPolicy(internalOrchestrationErrorPolicy, (error) =>
    error instanceof DomainVerificationLookupError
      ? { status: error.status, body: { error: error.message } }
      : null
  ),
  mapInput: ({ params }) => ({ organizationId: params.id, domainId: params.domainId }),
  useCase: verifyOrganizationDomain,
  present: (result) => ({ success: true, data: { domain: toDomainResponse(result.domain) } }),
})
