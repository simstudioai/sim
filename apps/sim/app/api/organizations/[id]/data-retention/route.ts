import {
  getOrganizationDataRetentionContract,
  updateOrganizationDataRetentionContract,
} from '@/lib/api/contracts/organization'
import { validationErrorResponse } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  getOrganizationDataRetention,
  updateOrganizationDataRetention,
} from '@/lib/organizations/application/configuration'
import { organizationConfigurationOperations } from '@/lib/organizations/application/configuration-operations'

export const GET = defineInternalJsonRoute({
  contract: getOrganizationDataRetentionContract,
  auth: internalSessionAuth,
  operation: organizationConfigurationOperations.readDataRetention,
  rateLimit: internalRateLimits.none({
    reason: 'Existing member-only organization configuration read',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: getOrganizationDataRetention,
  present: (data) => ({ success: true, data }),
})

export const PUT = defineInternalJsonRoute({
  contract: updateOrganizationDataRetentionContract,
  auth: internalSessionAuth,
  operation: organizationConfigurationOperations.updateDataRetention,
  rateLimit: internalRateLimits.none({
    reason: 'Existing administrator-only organization configuration update',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  parseOptions: {
    validationErrorResponse: (error) => validationErrorResponse(error, 'Invalid request body'),
  },
  mapInput: ({ params, body }) => ({ organizationId: params.id, settings: body }),
  useCase: updateOrganizationDataRetention,
  present: ({ data }) => ({ success: true, data }),
})
