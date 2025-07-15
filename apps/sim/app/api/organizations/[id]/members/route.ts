import { randomUUID } from 'crypto'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getEmailSubject, renderInvitationEmail } from '@/components/emails/render-email'
import { getSession } from '@/lib/auth'
import { validateSeatAvailability } from '@/lib/billing/validation/seat-management'
import { sendEmail } from '@/lib/email/mailer'
import { validateAndNormalizeEmail } from '@/lib/email/utils'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { invitation, member, organization, user, userStats } from '@/db/schema'

const logger = createLogger('OrganizationMembersAPI')

/**
 * GET /api/organizations/[id]/members
 * Get organization members with optional usage data
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
      const membersWithUsage = await db
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
          billingPeriodStart: userStats.billingPeriodStart,
          billingPeriodEnd: userStats.billingPeriodEnd,
          usageLimitSetBy: userStats.usageLimitSetBy,
          usageLimitUpdatedAt: userStats.usageLimitUpdatedAt,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .leftJoin(userStats, eq(user.id, userStats.userId))
        .where(eq(member.organizationId, organizationId))

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

/**
 * POST /api/organizations/[id]/members
 * Invite new member to organization
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: organizationId } = await params
    const { email, role = 'member' } = await request.json()

    // Validate input
    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    if (!['admin', 'member'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    // Validate and normalize email
    const { isValid, normalized: normalizedEmail } = validateAndNormalizeEmail(email)
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
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

    // Create invitation
    const invitationId = randomUUID()
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7) // 7 days expiry

    await db.insert(invitation).values({
      id: invitationId,
      email: normalizedEmail,
      inviterId: session.user.id,
      organizationId,
      role,
      status: 'pending',
      expiresAt,
      createdAt: new Date(),
    })

    const organizationEntry = await db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    const inviter = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1)

    const emailHtml = await renderInvitationEmail(
      inviter[0]?.name || 'Someone',
      organizationEntry[0]?.name || 'organization',
      `${env.NEXT_PUBLIC_APP_URL}/api/organizations/invitations/accept?id=${invitationId}`,
      normalizedEmail
    )

    const emailResult = await sendEmail({
      to: normalizedEmail,
      subject: getEmailSubject('invitation'),
      html: emailHtml,
      emailType: 'transactional',
    })

    if (emailResult.success) {
      logger.info('Member invitation sent', {
        email: normalizedEmail,
        organizationId,
        invitationId,
        role,
      })
    } else {
      logger.error('Failed to send invitation email', {
        email: normalizedEmail,
        error: emailResult.message,
      })
      // Don't fail the request if email fails
    }

    return NextResponse.json({
      success: true,
      message: `Invitation sent to ${normalizedEmail}`,
      data: {
        invitationId,
        email: normalizedEmail,
        role,
        expiresAt,
      },
    })
  } catch (error) {
    logger.error('Failed to invite organization member', {
      organizationId: (await params).id,
      error,
    })

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
