import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { acceptInvitationContract } from '@/lib/api/contracts/invitations'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { acceptInvitation } from '@/lib/invitations/core'

const logger = createLogger('InvitationAcceptAPI')

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()

    if (!session?.user?.id || !session.user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(acceptInvitationContract, request, context)
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params

    const result = await acceptInvitation({
      userId: session.user.id,
      userEmail: session.user.email,
      actorName: session.user.name ?? undefined,
      invitationId: id,
      token: parsed.data.body.token ?? null,
      request,
    })

    if (!result.success) {
      const statusMap: Record<string, number> = {
        'not-found': 404,
        'workspace-not-found': 404,
        'invalid-token': 400,
        'already-processed': 400,
        expired: 400,
        'email-mismatch': 403,
        'already-in-organization': 409,
        'no-seats-available': 400,
        'upgrade-required': 402,
        'server-error': 500,
      }
      const status = statusMap[result.kind] ?? 500
      logger.warn('Invitation accept rejected', { invitationId: id, reason: result.kind })
      /**
       * `error` stays the machine-readable kind (the client maps it to UX
       * states); `message` carries the human copy when the failure provides
       * one — e.g. the retryable concurrent-workspace-change conflict.
       */
      const message = result.kind === 'server-error' ? result.message : undefined
      return NextResponse.json({ error: result.kind, ...(message ? { message } : {}) }, { status })
    }

    const inv = result.invitation

    return NextResponse.json({
      success: true,
      redirectPath: result.redirectPath,
      invitation: {
        id: inv.id,
        kind: inv.kind,
        organizationId: inv.organizationId,
        acceptedWorkspaceIds: result.acceptedWorkspaceIds,
      },
    })
  }
)
