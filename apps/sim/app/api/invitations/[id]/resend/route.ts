import { db } from '@sim/db'
import { member, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { getSession } from '@/lib/auth'
import { getInvitationById } from '@/lib/invitations/core'
import { resendInvitationEmail, sendInvitationEmail } from '@/lib/invitations/send'
import { hasWorkspaceAdminAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('InvitationResendAPI')

async function isOrgAdmin(userId: string, organizationId: string): Promise<boolean> {
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1)
  return row?.role === 'owner' || row?.role === 'admin'
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const inv = await getInvitationById(id)
    if (!inv) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
    }
    if (inv.status !== 'pending') {
      return NextResponse.json({ error: 'Can only resend pending invitations' }, { status: 400 })
    }

    let canResend = false
    if (inv.organizationId) {
      canResend = await isOrgAdmin(session.user.id, inv.organizationId)
    }
    if (!canResend && inv.grants.length > 0) {
      const adminChecks = await Promise.all(
        inv.grants.map((grant) => hasWorkspaceAdminAccess(session.user.id, grant.workspaceId))
      )
      canResend = adminChecks.some(Boolean)
    }
    if (!canResend) {
      return NextResponse.json(
        { error: 'Only an organization or workspace admin can resend this invitation' },
        { status: 403 }
      )
    }

    const { token } = await resendInvitationEmail({ invitationId: id, rotateToken: true })

    const [inviterRow] = await db
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1)

    const emailResult = await sendInvitationEmail({
      invitationId: inv.id,
      token,
      kind: inv.kind,
      email: inv.email,
      inviterName: inviterRow?.name || inviterRow?.email || 'A user',
      organizationId: inv.organizationId,
      organizationRole: (inv.role as 'admin' | 'member') || 'member',
      grants: inv.grants.map((grant) => ({
        workspaceId: grant.workspaceId,
        permission: grant.permission,
      })),
    })

    if (!emailResult.success) {
      return NextResponse.json(
        { error: emailResult.error || 'Failed to send invitation email' },
        { status: 502 }
      )
    }

    recordAudit({
      workspaceId: inv.grants[0]?.workspaceId ?? null,
      actorId: session.user.id,
      actorName: session.user.name ?? undefined,
      actorEmail: session.user.email ?? undefined,
      action:
        inv.kind === 'workspace'
          ? AuditAction.INVITATION_RESENT
          : AuditAction.ORG_INVITATION_RESENT,
      resourceType:
        inv.kind === 'workspace' ? AuditResourceType.WORKSPACE : AuditResourceType.ORGANIZATION,
      resourceId: inv.organizationId ?? inv.grants[0]?.workspaceId ?? inv.id,
      description: `Resent ${inv.kind} invitation to ${inv.email}`,
      metadata: {
        invitationId: inv.id,
        targetEmail: inv.email,
        targetRole: inv.role,
        kind: inv.kind,
      },
      request,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Failed to resend invitation', { invitationId: id, error })
    return NextResponse.json({ error: 'Failed to resend invitation' }, { status: 500 })
  }
}
