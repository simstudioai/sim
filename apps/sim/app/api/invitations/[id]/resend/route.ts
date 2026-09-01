import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { invitationParamsSchema } from '@/lib/api/contracts/invitations'
import { getValidationErrorMessage } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { isOrganizationOwnerOrAdmin } from '@/lib/billing/core/organization'
import { isEnterprise, isTeam } from '@/lib/billing/plan-helpers'
import { hasUsableSubscriptionStatus } from '@/lib/billing/subscriptions/utils'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getInvitationById } from '@/lib/invitations/core'
import {
  persistInvitationResend,
  prepareInvitationResend,
  sendInvitationEmail,
} from '@/lib/invitations/send'
import { getWorkspaceWithOwner, hasWorkspaceAdminAccess } from '@/lib/workspaces/permissions/utils'
import { getWorkspaceInvitePolicy } from '@/lib/workspaces/policy'
import {
  InvitationsNotAllowedError,
  validateInvitationsAllowed,
} from '@/ee/access-control/utils/permission-check'

const logger = createLogger('InvitationResendAPI')

export const POST = withRouteHandler(
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
      if (inv.status !== 'pending') {
        return NextResponse.json({ error: 'Can only resend pending invitations' }, { status: 400 })
      }

      let canResend = false
      if (inv.organizationId) {
        canResend = await isOrganizationOwnerOrAdmin(session.user.id, inv.organizationId)
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

      /**
       * permission-group-enforced: invitations.send — a resend is a send.
       *
       * It re-delivers a working link and pushes `expiresAt` forward, so an
       * organization that has withheld invitations would otherwise still admit
       * new people: every pending invitation stays revivable indefinitely by
       * anyone who can reach this route, and each resend mints a fresh token.
       * The invitee has not joined yet — resend is the step that gets them in —
       * which is why this is not the webhook active-config carve-out, where the
       * reachability already exists and the edit only adjusts it.
       *
       * Each granted workspace resolves the group governing the caller there,
       * exactly as creation does. The organization scope is checked *as well*
       * for an organization-kind invitation, not instead: that kind always
       * admits the invitee to its stamped organization (`lib/invitations/core.ts`
       * documents it on `resolveInvitationJoinTarget`), so the resend performs an
       * organization-level admission whichever workspaces it also grants. Gating
       * only the grants would let an explicit workspace group that permits
       * invitations carry a member into an organization whose default group
       * withholds them — and would leave the organization-level act ungated the
       * moment such an invitation carried any grant at all. A workspace-kind
       * invitation admits nobody to the organization by itself, so it keeps the
       * per-grant check, falling back to the organization when it has no grants.
       *
       * Run after the admin check above, for the reason
       * `resolveWorkspaceInvitationContext` records — the refusal names an
       * organization setting, so it must not reach someone with no admin reach.
       */
      try {
        const organizationScoped = inv.kind === 'organization' || inv.grants.length === 0
        if (organizationScoped && inv.organizationId) {
          await validateInvitationsAllowed(session.user.id, {
            organizationId: inv.organizationId,
          })
        }
        for (const grant of inv.grants) {
          await validateInvitationsAllowed(session.user.id, { workspaceId: grant.workspaceId })
        }
      } catch (error) {
        if (error instanceof InvitationsNotAllowedError) {
          logger.warn('Invitation resend blocked by permission group', { invitationId: id })
          return NextResponse.json({ error: error.message }, { status: 403 })
        }
        throw error
      }

      for (const grant of inv.grants) {
        const workspaceDetails = await getWorkspaceWithOwner(grant.workspaceId)
        if (!workspaceDetails) {
          return NextResponse.json(
            { error: 'Invitation references a workspace that no longer exists' },
            { status: 409 }
          )
        }
        const policy = await getWorkspaceInvitePolicy(workspaceDetails)
        if (!policy.allowed) {
          return NextResponse.json(
            {
              error: policy.reason ?? 'Invites are no longer allowed on this workspace',
              upgradeRequired: policy.upgradeRequired,
            },
            { status: 403 }
          )
        }
      }

      if (inv.kind === 'organization' && inv.grants.length === 0 && inv.organizationId) {
        const orgSubscription = await getOrganizationSubscription(inv.organizationId)
        const orgOnTeamOrEnterprise =
          !!orgSubscription &&
          hasUsableSubscriptionStatus(orgSubscription.status) &&
          (isTeam(orgSubscription.plan) || isEnterprise(orgSubscription.plan))
        if (!orgOnTeamOrEnterprise) {
          return NextResponse.json(
            {
              error: 'Invites are no longer allowed on this organization',
              upgradeRequired: true,
            },
            { status: 403 }
          )
        }
      }

      const { tokenForEmail, nextToken, nextExpiresAt } = await prepareInvitationResend({
        invitationId: id,
        rotateToken: true,
        currentToken: inv.token,
      })

      const [inviterRow] = await db
        .select({ name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, session.user.id))
        .limit(1)

      const emailResult = await sendInvitationEmail({
        invitationId: inv.id,
        token: tokenForEmail,
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

      await persistInvitationResend({ invitationId: id, nextToken, nextExpiresAt })

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
          membershipIntent: inv.membershipIntent,
        },
        request,
      })

      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error('Failed to resend invitation', { invitationId: id, error })
      return NextResponse.json({ error: 'Failed to resend invitation' }, { status: 500 })
    }
  }
)
