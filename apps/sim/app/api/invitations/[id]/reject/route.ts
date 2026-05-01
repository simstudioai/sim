import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { rejectInvitationContract } from '@/lib/api/contracts/invitations'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { rejectInvitation } from '@/lib/invitations/core'

const logger = createLogger('InvitationRejectAPI')

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()

    if (!session?.user?.id || !session.user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(rejectInvitationContract, request, context)
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params

    const result = await rejectInvitation({
      userId: session.user.id,
      userEmail: session.user.email,
      invitationId: id,
      token: parsed.data.body.token ?? null,
    })

    if (!result.success) {
      const statusMap: Record<string, number> = {
        'not-found': 404,
        'invalid-token': 400,
        'already-processed': 400,
        expired: 400,
        'email-mismatch': 403,
      }
      const status = statusMap[result.kind] ?? 500
      logger.warn('Invitation reject rejected', { invitationId: id, reason: result.kind })
      return NextResponse.json({ error: result.kind }, { status })
    }

    const inv = result.invitation
    recordAudit({
      workspaceId: null,
      actorId: session.user.id,
      actorName: session.user.name ?? undefined,
      actorEmail: session.user.email ?? undefined,
      action:
        inv.kind === 'workspace'
          ? AuditAction.INVITATION_REJECTED
          : AuditAction.ORG_INVITATION_REJECTED,
      resourceType:
        inv.kind === 'workspace' ? AuditResourceType.WORKSPACE : AuditResourceType.ORGANIZATION,
      resourceId: inv.organizationId ?? inv.grants[0]?.workspaceId ?? inv.id,
      description: `Rejected ${inv.kind} invitation for ${inv.email}`,
      metadata: {
        invitationId: inv.id,
        targetEmail: inv.email,
        targetRole: inv.role,
        kind: inv.kind,
      },
      request,
    })

    return NextResponse.json({ success: true })
  }
)
