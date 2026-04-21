import { db } from '@sim/db'
import {
  invitation,
  member,
  subscription as subscriptionTable,
  user,
  userStats,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { getSession } from '@/lib/auth'
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import { validateSeatAvailability } from '@/lib/billing/validation/seat-management'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  cancelPendingInvitation,
  createPendingInvitation,
  sendInvitationEmail,
} from '@/lib/invitations/send'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import {
  InvitationsNotAllowedError,
  validateInvitationsAllowed,
} from '@/ee/access-control/utils/permission-check'

const logger = createLogger('OrganizationMembersAPI')

/**
 * GET /api/organizations/[id]/members
 * Get organization members with optional usage data
 */
export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()

      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { id: organizationId } = await params
      const url = new URL(request.url)
      const includeUsage = url.searchParams.get('include') === 'usage'

      // Verify user has access to this organization
      const memberEntry = await db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
        .limit(1)

      if (memberEntry.length === 0) {
        return NextResponse.json(
          { error: 'Forbidden - Not a member of this organization' },
          { status: 403 }
        )
      }

      const userRole = memberEntry[0].role
      const hasAdminAccess = ['owner', 'admin'].includes(userRole)

      // Get organization members
      const query = db
        .select({
          id: member.id,
          userId: member.userId,
          organizationId: member.organizationId,
          role: member.role,
          createdAt: member.createdAt,
          userName: user.name,
          userEmail: user.email,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(eq(member.organizationId, organizationId))

      // Include usage data if requested and user has admin access
      if (includeUsage && hasAdminAccess) {
        const base = await db
          .select({
            id: member.id,
            userId: member.userId,
            organizationId: member.organizationId,
            role: member.role,
            createdAt: member.createdAt,
            userName: user.name,
            userEmail: user.email,
            currentPeriodCost: userStats.currentPeriodCost,
            currentUsageLimit: userStats.currentUsageLimit,
            usageLimitUpdatedAt: userStats.usageLimitUpdatedAt,
          })
          .from(member)
          .innerJoin(user, eq(member.userId, user.id))
          .leftJoin(userStats, eq(user.id, userStats.userId))
          .where(eq(member.organizationId, organizationId))

        // The billing period is the same for every member — it comes from
        // whichever subscription covers them. Fetch once and attach to
        // every row instead of calling `getUserUsageData` per-member,
        // which would run an O(N) pooled query for each of N rows.
        const [orgSub] = await db
          .select({
            periodStart: subscriptionTable.periodStart,
            periodEnd: subscriptionTable.periodEnd,
          })
          .from(subscriptionTable)
          .where(
            and(
              eq(subscriptionTable.referenceId, organizationId),
              inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES)
            )
          )
          .limit(1)

        const billingPeriodStart = orgSub?.periodStart ?? null
        const billingPeriodEnd = orgSub?.periodEnd ?? null

        const membersWithUsage = base.map((row) => ({
          ...row,
          billingPeriodStart,
          billingPeriodEnd,
        }))

        return NextResponse.json({
          success: true,
          data: membersWithUsage,
          total: membersWithUsage.length,
          userRole,
          hasAdminAccess,
        })
      }

      const members = await query

      return NextResponse.json({
        success: true,
        data: members,
        total: members.length,
        userRole,
        hasAdminAccess,
      })
    } catch (error) {
      logger.error('Failed to get organization members', {
        organizationId: (await params).id,
        error,
      })

      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

/**
 * POST /api/organizations/[id]/members
 * Invite new member to organization
 */
export const POST = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()

      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { id: organizationId } = await params

      await validateInvitationsAllowed(session.user.id, { organizationId })

      const { email, role = 'member' } = await request.json()

      if (!email) {
        return NextResponse.json({ error: 'Email is required' }, { status: 400 })
      }

      if (!['admin', 'member'].includes(role)) {
        return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
      }

      // Validate and normalize email
      const normalizedEmail = email.trim().toLowerCase()
      const validation = quickValidateEmail(normalizedEmail)
      if (!validation.isValid) {
        return NextResponse.json(
          { error: validation.reason || 'Invalid email format' },
          { status: 400 }
        )
      }

      // Verify user has admin access
      const memberEntry = await db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
        .limit(1)

      if (memberEntry.length === 0) {
        return NextResponse.json(
          { error: 'Forbidden - Not a member of this organization' },
          { status: 403 }
        )
      }

      if (!['owner', 'admin'].includes(memberEntry[0].role)) {
        return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
      }

      // Check seat availability
      const seatValidation = await validateSeatAvailability(organizationId, 1)
      if (!seatValidation.canInvite) {
        return NextResponse.json(
          {
            error: `Cannot invite member. Using ${seatValidation.currentSeats} of ${seatValidation.maxSeats} seats.`,
            details: seatValidation,
          },
          { status: 400 }
        )
      }

      // Check if user is already a member
      const existingUser = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, normalizedEmail))
        .limit(1)

      if (existingUser.length > 0) {
        const existingMember = await db
          .select()
          .from(member)
          .where(
            and(eq(member.organizationId, organizationId), eq(member.userId, existingUser[0].id))
          )
          .limit(1)

        if (existingMember.length > 0) {
          return NextResponse.json(
            { error: 'User is already a member of this organization' },
            { status: 400 }
          )
        }
      }

      // Check for existing pending invitation
      const existingInvitation = await db
        .select()
        .from(invitation)
        .where(
          and(
            eq(invitation.organizationId, organizationId),
            eq(invitation.email, normalizedEmail),
            eq(invitation.status, 'pending')
          )
        )
        .limit(1)

      if (existingInvitation.length > 0) {
        return NextResponse.json(
          { error: 'Pending invitation already exists for this email' },
          { status: 400 }
        )
      }

      const { invitationId, token } = await createPendingInvitation({
        kind: 'organization',
        email: normalizedEmail,
        inviterId: session.user.id,
        organizationId,
        role: role as 'admin' | 'member',
        grants: [],
      })

      const [inviterRow] = await db
        .select({ name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, session.user.id))
        .limit(1)
      const inviterName = inviterRow?.name || inviterRow?.email || 'A user'

      const emailResult = await sendInvitationEmail({
        invitationId,
        token,
        kind: 'organization',
        email: normalizedEmail,
        inviterName,
        organizationId,
        organizationRole: role as 'admin' | 'member',
        grants: [],
      })

      if (!emailResult.success) {
        logger.error('Failed to send organization invitation email', {
          email: normalizedEmail,
          invitationId,
          error: emailResult.error,
        })
        await cancelPendingInvitation(invitationId)
        return NextResponse.json(
          { error: emailResult.error || 'Failed to send invitation email' },
          { status: 502 }
        )
      }

      logger.info('Member invitation sent', {
        email: normalizedEmail,
        organizationId,
        invitationId,
        role,
      })

      recordAudit({
        workspaceId: null,
        actorId: session.user.id,
        action: AuditAction.ORG_INVITATION_CREATED,
        resourceType: AuditResourceType.ORGANIZATION,
        resourceId: organizationId,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        description: `Invited ${normalizedEmail} to organization as ${role}`,
        metadata: { invitationId, targetEmail: normalizedEmail, targetRole: role },
        request,
      })

      return NextResponse.json({
        success: true,
        message: `Invitation sent to ${normalizedEmail}`,
        data: {
          invitationId,
          email: normalizedEmail,
          role,
        },
      })
    } catch (error) {
      if (error instanceof InvitationsNotAllowedError) {
        return NextResponse.json({ error: error.message }, { status: 403 })
      }
      logger.error('Failed to invite organization member', {
        organizationId: (await params).id,
        error,
      })

      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
