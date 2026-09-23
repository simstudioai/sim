import { internalOrchestrationErrorPolicy } from '@/lib/api/server/routes'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { InvitationManagementError } from '@/lib/invitations/application/manage-invitation'

/** Preserves invitation action status and upgrade guidance across internal adapters. */
export const invitationManagementErrorPolicy = {
  project(error: unknown) {
    if (error instanceof ForbiddenOperationError)
      return { status: 403, body: { error: error.message, details: { code: error.detailCode } } }
    if (error instanceof InvitationManagementError)
      return {
        status: error.status,
        body: {
          error: error.message,
          ...(error.upgradeRequired !== undefined
            ? { upgradeRequired: error.upgradeRequired }
            : {}),
        },
      }
    return internalOrchestrationErrorPolicy.project(error)
  },
}
