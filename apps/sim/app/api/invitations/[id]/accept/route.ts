import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { acceptInvitation } from '@/lib/invitations/core'

const logger = createLogger('InvitationAcceptAPI')

const bodySchema = z.object({ token: z.string().min(1).optional() })

export const POST = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const session = await getSession()

    if (!session?.user?.id || !session.user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const result = await acceptInvitation({
      userId: session.user.id,
      userEmail: session.user.email,
      invitationId: id,
      token: parsed.data.token ?? null,
    })

    if (!result.success) {
      const statusMap: Record<string, number> = {
        'not-found': 404,
        'invalid-token': 400,
        'already-processed': 400,
        expired: 400,
        'email-mismatch': 403,
        'already-in-organization': 409,
        'no-seats-available': 400,
        'server-error': 500,
      }
      const status = statusMap[result.kind] ?? 500
      logger.warn('Invitation accept rejected', { invitationId: id, reason: result.kind })
      return NextResponse.json({ error: result.kind }, { status })
    }

    const inv = result.invitation

    recordAudit({
      workspaceId: result.acceptedWorkspaceIds[0] ?? null,
      actorId: session.user.id,
      actorName: session.user.name ?? undefined,
      actorEmail: session.user.email ?? undefined,
      action:
        inv.kind === 'workspace'
          ? AuditAction.INVITATION_ACCEPTED
          : AuditAction.ORG_INVITATION_ACCEPTED,
      resourceType:
        inv.kind === 'workspace' ? AuditResourceType.WORKSPACE : AuditResourceType.ORGANIZATION,
      resourceId: inv.organizationId ?? result.acceptedWorkspaceIds[0] ?? inv.id,
      description: `Accepted ${inv.kind} invitation for ${inv.email}`,
      metadata: {
        invitationId: inv.id,
        targetEmail: inv.email,
        targetRole: inv.role,
        kind: inv.kind,
        workspaceIds: result.acceptedWorkspaceIds,
      },
      request,
    })

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
