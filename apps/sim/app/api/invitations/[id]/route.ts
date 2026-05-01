import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { invitation, invitationWorkspaceGrant } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  getInvitationContract,
  invitationParamsSchema,
  updateInvitationContract,
} from '@/lib/api/contracts/invitations'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { isOrganizationOwnerOrAdmin } from '@/lib/billing/core/organization'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { cancelInvitation, getInvitationById, normalizeEmail } from '@/lib/invitations/core'
import { hasWorkspaceAdminAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('InvitationsAPI')

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(getInvitationContract, request, context)
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const { token } = parsed.data.query

    try {
      const inv = await getInvitationById(id)
      if (!inv) {
        return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
      }

      const isInvitee = normalizeEmail(session.user.email || '') === normalizeEmail(inv.email)
      const tokenMatches = !!token && token === inv.token

      let hasAdminView = false
      if (inv.organizationId) {
        hasAdminView = await isOrganizationOwnerOrAdmin(session.user.id, inv.organizationId)
      }
      if (!hasAdminView && inv.grants.length > 0) {
        const adminChecks = await Promise.all(
          inv.grants.map((grant) => hasWorkspaceAdminAccess(session.user.id, grant.workspaceId))
        )
        hasAdminView = adminChecks.some(Boolean)
      }

      if (!isInvitee && !tokenMatches && !hasAdminView) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      return NextResponse.json({
        invitation: {
          id: inv.id,
          kind: inv.kind,
          email: inv.email,
          organizationId: inv.organizationId,
          organizationName: inv.organizationName,
          membershipIntent: inv.membershipIntent,
          role: inv.role,
          status: inv.status,
          expiresAt: inv.expiresAt,
          createdAt: inv.createdAt,
          inviterName: inv.inviterName,
          inviterEmail: inv.inviterEmail,
          grants: inv.grants.map((grant) => ({
            workspaceId: grant.workspaceId,
            workspaceName: grant.workspaceName,
            permission: grant.permission,
          })),
        },
      })
    } catch (error) {
      logger.error('Failed to fetch invitation', { invitationId: id, error })
      return NextResponse.json({ error: 'Failed to fetch invitation' }, { status: 500 })
    }
  }
)

export const PATCH = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(updateInvitationContract, request, context)
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const { role, grants } = parsed.data.body

    try {
      const inv = await getInvitationById(id)
      if (!inv) {
        return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
      }

      if (inv.status !== 'pending') {
        return NextResponse.json({ error: 'Can only modify pending invitations' }, { status: 400 })
      }

      if (role !== undefined) {
        if (inv.membershipIntent === 'external') {
          return NextResponse.json(
            { error: 'Role updates are not valid on external workspace invitations' },
            { status: 400 }
          )
        }
        if (!inv.organizationId) {
          return NextResponse.json(
            { error: 'Role updates are only valid on organization-scoped invitations' },
            { status: 400 }
          )
        }
        if (!(await isOrganizationOwnerOrAdmin(session.user.id, inv.organizationId))) {
          return NextResponse.json(
            { error: 'Only an organization owner or admin can change invitation roles' },
            { status: 403 }
          )
        }
      }

      const grantsToApply = grants ?? []
      for (const update of grantsToApply) {
        const belongsToInvite = inv.grants.some((g) => g.workspaceId === update.workspaceId)
        if (!belongsToInvite) {
          return NextResponse.json(
            { error: `Invitation does not grant access to workspace ${update.workspaceId}` },
            { status: 400 }
          )
        }
        if (!(await hasWorkspaceAdminAccess(session.user.id, update.workspaceId))) {
          return NextResponse.json(
            { error: 'Workspace admin access required to change grant permissions' },
            { status: 403 }
          )
        }
      }

      await db.transaction(async (tx) => {
        if (role !== undefined && role !== inv.role) {
          await tx
            .update(invitation)
            .set({ role, updatedAt: new Date() })
            .where(eq(invitation.id, id))
        }
        for (const update of grantsToApply) {
          await tx
            .update(invitationWorkspaceGrant)
            .set({ permission: update.permission, updatedAt: new Date() })
            .where(
              and(
                eq(invitationWorkspaceGrant.invitationId, id),
                eq(invitationWorkspaceGrant.workspaceId, update.workspaceId)
              )
            )
        }
      })

      const isOrgScoped = inv.kind === 'organization'
      const primaryWorkspaceId = inv.grants[0]?.workspaceId ?? null
      recordAudit({
        workspaceId: isOrgScoped ? null : primaryWorkspaceId,
        actorId: session.user.id,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        action: isOrgScoped ? AuditAction.ORG_INVITATION_UPDATED : AuditAction.INVITATION_UPDATED,
        resourceType: isOrgScoped ? AuditResourceType.ORGANIZATION : AuditResourceType.WORKSPACE,
        resourceId: isOrgScoped ? (inv.organizationId ?? inv.id) : (primaryWorkspaceId ?? inv.id),
        description: `Updated ${inv.kind} invitation for ${inv.email}`,
        metadata: {
          invitationId: id,
          targetEmail: inv.email,
          kind: inv.kind,
          membershipIntent: inv.membershipIntent,
          roleUpdate: role ?? null,
          grantUpdates: grantsToApply,
        },
        request,
      })

      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error('Failed to update invitation', { invitationId: id, error })
      return NextResponse.json({ error: 'Failed to update invitation' }, { status: 500 })
    }
  }
)

export const DELETE = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const parsedParams = invitationParamsSchema.safeParse(await params)
    if (!parsedParams.success) {
      return NextResponse.json(
        { error: getValidationErrorMessage(parsedParams.error) },
        { status: 400 }
      )
    }
    const { id } = parsedParams.data
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
      const inv = await getInvitationById(id)
      if (!inv) {
        return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
      }

      let canCancel = false
      if (inv.organizationId) {
        canCancel = await isOrganizationOwnerOrAdmin(session.user.id, inv.organizationId)
      }
      if (!canCancel && inv.grants.length > 0) {
        const adminChecks = await Promise.all(
          inv.grants.map((grant) => hasWorkspaceAdminAccess(session.user.id, grant.workspaceId))
        )
        canCancel = adminChecks.some(Boolean)
      }

      if (!canCancel) {
        return NextResponse.json(
          { error: 'Only an organization or workspace admin can cancel this invitation' },
          { status: 403 }
        )
      }

      if (inv.status !== 'pending') {
        return NextResponse.json({ error: 'Can only cancel pending invitations' }, { status: 400 })
      }

      const cancelled = await cancelInvitation(id)
      if (!cancelled) {
        return NextResponse.json({ error: 'Invitation not cancellable' }, { status: 400 })
      }

      recordAudit({
        workspaceId: inv.grants[0]?.workspaceId ?? null,
        actorId: session.user.id,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        action:
          inv.kind === 'workspace'
            ? AuditAction.INVITATION_REVOKED
            : AuditAction.ORG_INVITATION_REVOKED,
        resourceType:
          inv.kind === 'workspace' ? AuditResourceType.WORKSPACE : AuditResourceType.ORGANIZATION,
        resourceId: inv.organizationId ?? inv.grants[0]?.workspaceId ?? id,
        description: `Cancelled ${inv.kind} invitation for ${inv.email}`,
        metadata: {
          invitationId: id,
          targetEmail: inv.email,
          targetRole: inv.role,
          kind: inv.kind,
        },
        request,
      })

      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error('Failed to cancel invitation', { invitationId: id, error })
      return NextResponse.json({ error: 'Failed to cancel invitation' }, { status: 500 })
    }
  }
)
