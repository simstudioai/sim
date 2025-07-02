import { randomUUID } from 'crypto'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { getSession } from '@/lib/auth'
import { validateSeatAvailability } from '@/lib/billing/validation/seat-management'
import { createLogger } from '@/lib/logs/console-logger'
import { validateAndNormalizeEmail } from '@/lib/utils/email-validation'
import { db } from '@/db'
import * as schema from '@/db/schema'

const logger = createLogger('OrganizationMembersAPI')
const resend = new Resend(process.env.RESEND_API_KEY)

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
    const member = await db
      .select()
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, organizationId),
          eq(schema.member.userId, session.user.id)
        )
      )
      .limit(1)

    if (member.length === 0) {
      return NextResponse.json(
        { error: 'Forbidden - Not a member of this organization' },
        { status: 403 }
      )
    }

    const userRole = member[0].role
    const hasAdminAccess = ['owner', 'admin'].includes(userRole)

    // Get organization members
    const query = db
      .select({
        id: schema.member.id,
        userId: schema.member.userId,
        organizationId: schema.member.organizationId,
        role: schema.member.role,
        createdAt: schema.member.createdAt,
        userName: schema.user.name,
        userEmail: schema.user.email,
      })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
      .where(eq(schema.member.organizationId, organizationId))

    // Include usage data if requested and user has admin access
    if (includeUsage && hasAdminAccess) {
      const membersWithUsage = await db
        .select({
          id: schema.member.id,
          userId: schema.member.userId,
          organizationId: schema.member.organizationId,
          role: schema.member.role,
          createdAt: schema.member.createdAt,
          userName: schema.user.name,
          userEmail: schema.user.email,
          currentPeriodCost: schema.userStats.currentPeriodCost,
          currentUsageLimit: schema.userStats.currentUsageLimit,
          billingPeriodStart: schema.userStats.billingPeriodStart,
          billingPeriodEnd: schema.userStats.billingPeriodEnd,
          usageLimitSetBy: schema.userStats.usageLimitSetBy,
          usageLimitUpdatedAt: schema.userStats.usageLimitUpdatedAt,
        })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
        .leftJoin(schema.userStats, eq(schema.user.id, schema.userStats.userId))
        .where(eq(schema.member.organizationId, organizationId))

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
    const normalizedEmail = validateAndNormalizeEmail(email)
    if (!normalizedEmail) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
    }

    // Verify user has admin access
    const member = await db
      .select()
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, organizationId),
          eq(schema.member.userId, session.user.id)
        )
      )
      .limit(1)

    if (member.length === 0) {
      return NextResponse.json(
        { error: 'Forbidden - Not a member of this organization' },
        { status: 403 }
      )
    }

    if (!['owner', 'admin'].includes(member[0].role)) {
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
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, normalizedEmail))
      .limit(1)

    if (existingUser.length > 0) {
      const existingMember = await db
        .select()
        .from(schema.member)
        .where(
          and(
            eq(schema.member.organizationId, organizationId),
            eq(schema.member.userId, existingUser[0].id)
          )
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
      .from(schema.invitation)
      .where(
        and(
          eq(schema.invitation.organizationId, organizationId),
          eq(schema.invitation.email, normalizedEmail),
          eq(schema.invitation.status, 'pending')
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

    await db.insert(schema.invitation).values({
      id: invitationId,
      email: normalizedEmail,
      inviterId: session.user.id,
      organizationId,
      role,
      status: 'pending',
      expiresAt,
      createdAt: new Date(),
    })

    // Get organization and inviter details for email
    const organization = await db
      .select({ name: schema.organization.name })
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .limit(1)

    const inviter = await db
      .select({ name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, session.user.id))
      .limit(1)

    // Send invitation email
    try {
      await resend.emails.send({
        from: 'SimStudio <noreply@simstudio.ai>',
        to: normalizedEmail,
        subject: `Invitation to join ${organization[0]?.name || 'organization'}`,
        html: `
          <h2>You've been invited to join ${organization[0]?.name || 'an organization'}!</h2>
          <p><strong>${inviter[0]?.name || 'Someone'}</strong> has invited you to join their team on SimStudio.</p>
          <p>Role: ${role.charAt(0).toUpperCase() + role.slice(1)}</p>
          <p><a href="${process.env.NEXT_PUBLIC_BASE_URL}/api/organizations/invitations/accept?id=${invitationId}">Accept Invitation</a></p>
          <p>This invitation will expire in 7 days.</p>
        `,
      })

      logger.info('Member invitation sent', {
        email: normalizedEmail,
        organizationId,
        invitationId,
        role,
      })
    } catch (emailError) {
      logger.error('Failed to send invitation email', {
        email: normalizedEmail,
        error: emailError,
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
