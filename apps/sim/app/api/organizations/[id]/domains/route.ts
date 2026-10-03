import {
  addOrganizationDomainContract,
  listOrganizationDomainsContract,
} from '@/lib/api/contracts/organization'
import { validationErrorResponse } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { toDomainResponse } from '@/lib/auth/sso/domain-verification'
import {
  addOrganizationDomain,
  listOrganizationDomains,
} from '@/lib/organizations/application/domain-settings'

export const GET = defineInternalJsonRoute({
  contract: listOrganizationDomainsContract,
  operation: listOrganizationDomains.operation,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.none({
    reason: 'Preserves existing organization domain management policy',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: listOrganizationDomains,
  present: (result) => ({
    success: true,
    data: {
      isEnterprise: result.isEnterprise,
      domains: result.domains.map((row) => toDomainResponse(row)),
    },
  }),
})

export const POST = defineInternalJsonRoute({
  contract: addOrganizationDomainContract,
  operation: addOrganizationDomain.operation,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.none({
    reason: 'Preserves existing organization domain management policy',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ organizationId: params.id, domain: body.domain }),
  useCase: addOrganizationDomain,
  present: (result) => ({ success: true, data: { domain: toDomainResponse(result.domain) } }),
  parseOptions: {
    validationErrorResponse: (error) => validationErrorResponse(error, 'Invalid request body'),
  },
})
