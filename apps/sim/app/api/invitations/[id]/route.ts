import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { normalizeEmail } from '@sim/utils/string'
import { type NextRequest, NextResponse } from 'next/server'
import {
  cancelInvitationContract,
  getInvitationContract,
  updateInvitationContract,
} from '@/lib/api/contracts/invitations'
import { parseRequest } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getSession } from '@/lib/auth'
import { isOrganizationOwnerOrAdmin } from '@/lib/billing/core/organization'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  cancelInvitation,
  invitationManagementOperations,
} from '@/lib/invitations/application/manage-invitation'
import {
  getInvitationById,
  getInvitationJoinPreview,
  isInvitationExpired,
  updateInvitation,
} from '@/lib/invitations/core'
import { invitationManagementErrorPolicy } from '@/lib/invitations/management-error-policy'
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

      if (!isInvitee && !tokenMatches) {
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
        if (!hasAdminView) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
      }

      /**
       * Supplies the disclosure token acceptance is checked against, so a preview
       * failure must never block viewing or accepting the invitation itself — the
       * accept path simply runs without the guard. Expired-but-still-pending rows
       * get no preview; acceptance deterministically rejects them.
       */
      let joinPreview = null
      if (isInvitee && inv.status === 'pending' && !isInvitationExpired(inv)) {
        try {
          joinPreview = await getInvitationJoinPreview(session.user.id, inv)
        } catch (previewError) {
          logger.warn('Failed to compute invitation join preview', {
            invitationId: id,
            error: previewError,
          })
        }
      }

      return NextResponse.json({
        joinPreview,
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
      const result = await updateInvitation({
        actorId: session.user.id,
        invitationId: id,
        role,
        grants,
      })
      if (!result.success) {
        const errorByKind = {
          'not-found': ['Invitation not found', 404],
          'not-pending': ['Can only modify pending invitations', 400],
          'external-role': ['Role updates are not valid on external workspace invitations', 400],
          'role-not-organization-scoped': [
            'Role updates are only valid on organization-scoped invitations',
            400,
          ],
          'organization-forbidden': [
            'Only an organization owner or admin can change invitation roles',
            403,
          ],
          'member-requires-workspace': [
            'Member invitations must include at least one workspace. Keep the admin role or send a new invitation with workspace access.',
            400,
          ],
          'grant-not-found': [
            `Invitation does not grant access to workspace ${result.workspaceId}`,
            400,
          ],
          'workspace-forbidden': [
            'Workspace admin access required to change grant permissions',
            403,
          ],
        } as const
        const [error, status] = errorByKind[result.kind]
        return NextResponse.json({ error }, { status })
      }

      const inv = result.invitation
      const grantsToApply = grants ?? []
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

export const DELETE = defineInternalJsonRoute({
  contract: cancelInvitationContract,
  auth: internalSessionAuth,
  operation: invitationManagementOperations.cancel,
  rateLimit: internalRateLimits.none({
    reason: 'Preserves the existing authenticated invitation cancellation policy',
  }),
  errorPolicy: {
    ...invitationManagementErrorPolicy,
    unhandled: () => ({ status: 500, body: { error: 'Failed to cancel invitation' } }),
  },
  mapInput: ({ params, query }) => ({
    invitationId: params.id,
    ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
  }),
  useCase: cancelInvitation,
})
