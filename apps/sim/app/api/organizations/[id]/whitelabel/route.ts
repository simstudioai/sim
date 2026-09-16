import {
  getOrganizationWhitelabelContract,
  updateOrganizationWhitelabelContract,
} from '@/lib/api/contracts/organization'
import { validationErrorResponse } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  getOrganizationWhitelabel,
  updateOrganizationWhitelabel,
} from '@/lib/organizations/application/configuration'
import { organizationConfigurationOperations } from '@/lib/organizations/application/configuration-operations'

export const GET = defineInternalJsonRoute({
  contract: getOrganizationWhitelabelContract,
  auth: internalSessionAuth,
  operation: organizationConfigurationOperations.readWhitelabel,
  rateLimit: internalRateLimits.none({
    reason: 'Existing member-only organization configuration read',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: getOrganizationWhitelabel,
  present: (data) => ({ success: true, data }),
})

export const PUT = defineInternalJsonRoute({
  contract: updateOrganizationWhitelabelContract,
  auth: internalSessionAuth,
  operation: organizationConfigurationOperations.updateWhitelabel,
  rateLimit: internalRateLimits.none({
    reason: 'Existing administrator-only organization configuration update',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  parseOptions: {
    validationErrorResponse: (error) => validationErrorResponse(error, 'Invalid request body'),
  },
  mapInput: ({ params, body }) => ({ organizationId: params.id, settings: body }),
  useCase: updateOrganizationWhitelabel,
  present: ({ data }) => ({ success: true, data }),
})
