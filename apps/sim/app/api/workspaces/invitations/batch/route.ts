import { batchWorkspaceInvitationsContract } from '@/lib/api/contracts/invitations'
import {
  defineInternalJsonRoute,
  internalErrorResponse,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  invitationOperations,
  sendInvitationBatch,
} from '@/lib/invitations/application/send-invitation-batch'
import { WorkspaceInvitationError } from '@/lib/invitations/workspace-invitations'
import { InvitationsNotAllowedError } from '@/ee/access-control/utils/permission-check'

export const dynamic = 'force-dynamic'

export const POST = defineInternalJsonRoute({
  contract: batchWorkspaceInvitationsContract,
  auth: internalSessionAuth,
  operation: invitationOperations.sendBatch,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve the existing bounded invitation batch behavior.',
  }),
  errorPolicy: {
    project(error) {
      if (error instanceof WorkspaceInvitationError) {
        return internalErrorResponse(error.status, {
          error: error.message,
          ...(error.email ? { email: error.email } : {}),
          ...(error.upgradeRequired !== undefined
            ? { upgradeRequired: error.upgradeRequired }
            : {}),
        })
      }
      if (error instanceof InvitationsNotAllowedError)
        return internalErrorResponse(403, { error: error.message })
      return null
    },
    unhandled: () => internalErrorResponse(500, { error: 'Failed to create invitation batch' }),
  },
  mapInput: ({ body }) => body,
  useCase: sendInvitationBatch,
})
