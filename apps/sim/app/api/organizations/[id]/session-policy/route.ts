import {
  getOrganizationSessionPolicyContract,
  updateOrganizationSessionPolicyContract,
} from '@/lib/api/contracts/organization'
import { validationErrorResponse } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  getOrganizationSessionPolicy,
  updateOrganizationSessionPolicy,
} from '@/lib/organizations/application/configuration'
import { organizationConfigurationOperations } from '@/lib/organizations/application/configuration-operations'

export const GET = defineInternalJsonRoute({
  contract: getOrganizationSessionPolicyContract,
  auth: internalSessionAuth,
  operation: organizationConfigurationOperations.readSessionPolicy,
  rateLimit: internalRateLimits.none({
    reason: 'Existing member-only organization configuration read',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: getOrganizationSessionPolicy,
  present: (data) => ({ success: true, data }),
})

export const PUT = defineInternalJsonRoute({
  contract: updateOrganizationSessionPolicyContract,
  auth: internalSessionAuth,
  operation: organizationConfigurationOperations.updateSessionPolicy,
  rateLimit: internalRateLimits.none({
    reason: 'Existing administrator-only organization configuration update',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  parseOptions: {
    validationErrorResponse: (error) => validationErrorResponse(error, 'Invalid request body'),
  },
  mapInput: ({ params, body }) => ({ organizationId: params.id, settings: body }),
  useCase: updateOrganizationSessionPolicy,
  present: ({ data }) => ({ success: true, data }),
})
