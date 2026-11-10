import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  createOrganizationContract,
  listCreatorOrganizationsContract,
} from '@/lib/api/contracts/organizations'
import { getValidationErrorMessage, validationErrorResponse } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { setActiveOrganizationForCurrentSession } from '@/lib/auth/active-organization'
import {
  createTeamOrganization,
  listAdministeredTeamOrganizations,
} from '@/lib/organizations/application/team-organizations'
import { captureServerEvent } from '@/lib/posthog/server'

const logger = createLogger('OrganizationsAPI')

export const GET = defineInternalJsonRoute({
  contract: listCreatorOrganizationsContract,
  auth: internalSessionAuth,
  operation: listAdministeredTeamOrganizations.operation,
  rateLimit: internalRateLimits.none({ reason: 'Preserve organization listing behavior' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: () => ({}),
  useCase: listAdministeredTeamOrganizations,
})

export const POST = defineInternalJsonRoute({
  contract: createOrganizationContract,
  auth: internalSessionAuth,
  operation: createTeamOrganization.operation,
  rateLimit: internalRateLimits.none({ reason: 'Preserve organization creation behavior' }),
  errorPolicy: {
    project: (error) => {
      const classified = internalOrchestrationErrorPolicy.project(error)
      if (classified) return classified
      logger.error('Failed to create organization for team plan', { error })
      return internalErrorResponse(500, {
        error: 'Failed to create organization',
        message: getErrorMessage(error, 'Unknown error'),
      })
    },
  },
  parseOptions: {
    optionalJsonBody: true,
    validationErrorResponse: (error) =>
      validationErrorResponse(error, getValidationErrorMessage(error, 'Invalid request body')),
  },
  mapInput: ({ body }) => ({ name: body?.name, slug: body?.slug }),
  useCase: createTeamOrganization,
  onSuccess: async ({ principal, result }) => {
    try {
      await setActiveOrganizationForCurrentSession(result.organizationId)
    } catch (error) {
      logger.error('Failed to activate organization after creation', {
        organizationId: result.organizationId,
        error: getErrorMessage(error),
      })
    }
    if (!result.created) return
    captureServerEvent(
      principal.userId,
      'organization_created',
      {
        organization_id: result.organizationId,
        ...(result.organizationName ? { name: result.organizationName } : {}),
      },
      { groups: { organization: result.organizationId } }
    )
  },
  present: ({ organizationId, created }) => ({ success: true, organizationId, created }),
})
