import {
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
} from '@/lib/api/server/routes/internal-json-route'
import type { V2ErrorPolicy } from '@/lib/api/server/routes/v2-json-route'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { OrganizationMembershipNotFoundError } from '@/lib/core/application/organization-authorization'
import { isRetryableTransactionError } from '@/lib/db/transaction'
import { WorkspaceInvitationError } from '@/lib/invitations/workspace-invitations'
import { CAPABILITY_RULES, capabilityRefusal } from '@/lib/permission-groups/capabilities'
import { v2CaughtOrchestrationError, v2Error } from '@/app/api/v2/lib/response'
import { InvitationsNotAllowedError } from '@/ee/access-control/utils/permission-check'

export const internalOrganizationErrorPolicy = extendInternalErrorPolicy(
  internalOrchestrationErrorPolicy,
  (error) => {
    if (error instanceof OrganizationMembershipNotFoundError)
      return internalErrorResponse(403, { error: 'Forbidden - Not a member of this organization' })
    if (error instanceof ForbiddenOperationError)
      return internalErrorResponse(403, {
        error: error.message,
        details: { code: error.detailCode },
      })
    if (error instanceof WorkspaceInvitationError)
      return internalErrorResponse(error.status, {
        error: error.message,
        ...(error.email ? { email: error.email } : {}),
        ...(error.upgradeRequired === undefined ? {} : { upgradeRequired: error.upgradeRequired }),
      })
    if (error instanceof InvitationsNotAllowedError)
      return internalErrorResponse(403, {
        error: capabilityRefusal('invitations.send'),
        details: { code: CAPABILITY_RULES['invitations.send'].detailCode },
      })
    if (isRetryableTransactionError(error))
      return internalErrorResponse(409, { error: 'The organization is busy; retry in a moment' })
    return null
  }
)

export const v2OrganizationErrorPolicy: V2ErrorPolicy = {
  render(error) {
    if (error instanceof InvitationsNotAllowedError)
      return v2Error('FORBIDDEN', capabilityRefusal('invitations.send'), {
        details: { code: CAPABILITY_RULES['invitations.send'].detailCode },
      })
    if (error instanceof WorkspaceInvitationError) {
      if (error.status >= 500)
        return v2Error(
          'SERVICE_UNAVAILABLE',
          'Invitation delivery is temporarily unavailable. Check the invitation status before retrying.'
        )
      if (error.status === 409) return v2Error('CONFLICT', error.message)
      if (error.status === 403)
        return v2Error('FORBIDDEN', error.message, {
          details: {
            code: error.upgradeRequired
              ? 'ORGANIZATION_PLAN_REQUIRED'
              : 'ORGANIZATION_ADMIN_REQUIRED',
          },
        })
      return v2Error('BAD_REQUEST', error.message)
    }
    if (isRetryableTransactionError(error))
      return v2Error('SERVICE_UNAVAILABLE', 'The organization is busy; retry in a moment')
    return v2CaughtOrchestrationError(error)
  },
}
