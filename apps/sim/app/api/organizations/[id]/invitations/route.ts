import { randomUUID } from 'crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  getEmailSubject,
  renderBatchInvitationEmail,
  renderInvitationEmail,
} from '@/components/emails/render-email'
import { getSession } from '@/lib/auth'
import {
  validateBulkInvitations,
  validateSeatAvailability,
} from '@/lib/billing/validation/seat-management'
import { sendEmail } from '@/lib/email/mailer'
import { validateAndNormalizeEmail } from '@/lib/email/utils'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'
import { hasWorkspaceAdminAccess } from '@/lib/permissions/utils'
import { db } from '@/db'
import { invitation, member, organization, user, workspace, workspaceInvitation } from '@/db/schema'

const logger = createLogger('OrganizationInvitationsAPI')

interface WorkspaceInvitation {
  workspaceId: string
  permission: 'admin' | 'write' | 'read'
}

/**
 * GET /api/organizations/[id]/invitations
 * Get all pending invitations for an organization
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: organizationId } = await params

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

    if (!hasAdminAccess) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
    }

    // Get all pending invitations for the organization
    const invitations = await db
      .select({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
        inviterName: user.name,
        inviterEmail: user.email,
      })
      .from(invitation)
      .leftJoin(user, eq(invitation.inviterId, user.id))
      .where(eq(invitation.organizationId, organizationId))
      .orderBy(invitation.createdAt)

    return NextResponse.json({
      success: true,
      data: {
        invitations,
        userRole,
      },
    })
  } catch (error) {
    logger.error('Failed to get organization invitations', {
      organizationId: (await params).id,
      error,
    })

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/organizations/[id]/invitations
 * Create organization invitations with optional validation and batch workspace invitations
 * Query parameters:
 * - ?validate=true - Only validate, don't send invitations
 * - ?batch=true - Include workspace invitations
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: organizationId } = await params
    const url = new URL(request.url)
    const validateOnly = url.searchParams.get('validate') === 'true'
    const isBatch = url.searchParams.get('batch') === 'true'

    const body = await request.json()
    const { email, emails, role = 'member', workspaceInvitations } = body

    // Handle single invitation vs batch
    const invitationEmails = email ? [email] : emails

    // Validate input
    if (!invitationEmails || !Array.isArray(invitationEmails) || invitationEmails.length === 0) {
      return NextResponse.json({ error: 'Email or emails array is required' }, { status: 400 })
    }

    if (!['member', 'admin'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
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

    // Handle validation-only requests
    if (validateOnly) {
      const validationResult = await validateBulkInvitations(organizationId, invitationEmails)

      logger.info('Invitation validation completed', {
        organizationId,
        userId: session.user.id,
        emailCount: invitationEmails.length,
        result: validationResult,
      })

      return NextResponse.json({
        success: true,
        data: validationResult,
        validatedBy: session.user.id,
        validatedAt: new Date().toISOString(),
      })
    }

    // Validate seat availability
    const seatValidation = await validateSeatAvailability(organizationId, invitationEmails.length)

    if (!seatValidation.canInvite) {
      return NextResponse.json(
        {
          error: seatValidation.reason,
          seatInfo: {
            currentSeats: seatValidation.currentSeats,
            maxSeats: seatValidation.maxSeats,
            availableSeats: seatValidation.availableSeats,
            seatsRequested: invitationEmails.length,
          },
        },
        { status: 400 }
      )
    }

    // Get organization details
    const organizationEntry = await db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (organizationEntry.length === 0) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    // Validate and normalize emails
    const processedEmails = invitationEmails
      .map((email: string) => {
        const result = validateAndNormalizeEmail(email)
        return result.isValid ? result.normalized : null
      })
      .filter(Boolean) as string[]

    if (processedEmails.length === 0) {
      return NextResponse.json({ error: 'No valid emails provided' }, { status: 400 })
    }

    // Handle batch workspace invitations if provided
    const validWorkspaceInvitations: WorkspaceInvitation[] = []
    if (isBatch && workspaceInvitations && workspaceInvitations.length > 0) {
      for (const wsInvitation of workspaceInvitations) {
        // Check if user has admin permission on this workspace
        const canInvite = await hasWorkspaceAdminAccess(session.user.id, wsInvitation.workspaceId)

        if (!canInvite) {
          return NextResponse.json(
            {
              error: `You don't have permission to invite users to workspace ${wsInvitation.workspaceId}`,
            },
            { status: 403 }
          )
        }

        validWorkspaceInvitations.push(wsInvitation)
      }
    }

    // Check for existing members
    const existingMembers = await db
      .select({ userEmail: user.email })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(member.organizationId, organizationId))

    const existingEmails = existingMembers.map((m) => m.userEmail)
    const newEmails = processedEmails.filter((email: string) => !existingEmails.includes(email))

    // Check for existing pending invitations
    const existingInvitations = await db
      .select({ email: invitation.email })
      .from(invitation)
      .where(and(eq(invitation.organizationId, organizationId), eq(invitation.status, 'pending')))

    const pendingEmails = existingInvitations.map((i) => i.email)
    const emailsToInvite = newEmails.filter((email: string) => !pendingEmails.includes(email))

    if (emailsToInvite.length === 0) {
      return NextResponse.json(
        {
          error: 'All emails are already members or have pending invitations',
          details: {
            existingMembers: processedEmails.filter((email: string) =>
              existingEmails.includes(email)
            ),
            pendingInvitations: processedEmails.filter((email: string) =>
              pendingEmails.includes(email)
            ),
          },
        },
        { status: 400 }
      )
    }

    // Create invitations
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    const invitationsToCreate = emailsToInvite.map((email: string) => ({
      id: randomUUID(),
      email,
      inviterId: session.user.id,
      organizationId,
      role,
      status: 'pending' as const,
      expiresAt,
      createdAt: new Date(),
    }))

    await db.insert(invitation).values(invitationsToCreate)

    // Create workspace invitations if batch mode
    const workspaceInvitationIds: string[] = []
    if (isBatch && validWorkspaceInvitations.length > 0) {
      for (const email of emailsToInvite) {
        for (const wsInvitation of validWorkspaceInvitations) {
          const wsInvitationId = randomUUID()
          const token = randomUUID()

          await db.insert(workspaceInvitation).values({
            id: wsInvitationId,
            workspaceId: wsInvitation.workspaceId,
            email,
            inviterId: session.user.id,
            role: 'member',
            status: 'pending',
            token,
            permissions: wsInvitation.permission,
            expiresAt,
            createdAt: new Date(),
            updatedAt: new Date(),
          })

          workspaceInvitationIds.push(wsInvitationId)
        }
      }
    }

    // Send invitation emails
    const inviter = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1)

    for (const email of emailsToInvite) {
      const orgInvitation = invitationsToCreate.find((inv) => inv.email === email)
      if (!orgInvitation) continue

      let emailResult
      if (isBatch && validWorkspaceInvitations.length > 0) {
        // Get workspace details for batch email
        const workspaceDetails = await db
          .select({
            id: workspace.id,
            name: workspace.name,
          })
          .from(workspace)
          .where(
            inArray(
              workspace.id,
              validWorkspaceInvitations.map((w) => w.workspaceId)
            )
          )

        const workspaceInvitationsWithNames = validWorkspaceInvitations.map((wsInv) => ({
          workspaceId: wsInv.workspaceId,
          workspaceName:
            workspaceDetails.find((w) => w.id === wsInv.workspaceId)?.name || 'Unknown Workspace',
          permission: wsInv.permission,
        }))

        const emailHtml = await renderBatchInvitationEmail(
          inviter[0]?.name || 'Someone',
          organizationEntry[0]?.name || 'organization',
          role,
          workspaceInvitationsWithNames,
          `${env.NEXT_PUBLIC_APP_URL}/api/organizations/invitations/accept?id=${orgInvitation.id}`
        )

        emailResult = await sendEmail({
          to: email,
          subject: getEmailSubject('batch-invitation'),
          html: emailHtml,
          emailType: 'transactional',
        })
      } else {
        const emailHtml = await renderInvitationEmail(
          inviter[0]?.name || 'Someone',
          organizationEntry[0]?.name || 'organization',
          `${env.NEXT_PUBLIC_APP_URL}/api/organizations/invitations/accept?id=${orgInvitation.id}`,
          email
        )

        emailResult = await sendEmail({
          to: email,
          subject: getEmailSubject('invitation'),
          html: emailHtml,
          emailType: 'transactional',
        })
      }

      if (!emailResult.success) {
        logger.error('Failed to send invitation email', {
          email,
          error: emailResult.message,
        })
      }
    }

    logger.info('Organization invitations created', {
      organizationId,
      invitedBy: session.user.id,
      invitationCount: invitationsToCreate.length,
      emails: emailsToInvite,
      role,
      isBatch,
      workspaceInvitationCount: workspaceInvitationIds.length,
    })

    return NextResponse.json({
      success: true,
      message: `${invitationsToCreate.length} invitation(s) sent successfully`,
      data: {
        invitationsSent: invitationsToCreate.length,
        invitedEmails: emailsToInvite,
        existingMembers: processedEmails.filter((email: string) => existingEmails.includes(email)),
        pendingInvitations: processedEmails.filter((email: string) =>
          pendingEmails.includes(email)
        ),
        invalidEmails: invitationEmails.filter(
          (email: string) => !validateAndNormalizeEmail(email)
        ),
        workspaceInvitations: isBatch ? validWorkspaceInvitations.length : 0,
        seatInfo: {
          seatsUsed: seatValidation.currentSeats + invitationsToCreate.length,
          maxSeats: seatValidation.maxSeats,
          availableSeats: seatValidation.availableSeats - invitationsToCreate.length,
        },
      },
    })
  } catch (error) {
    logger.error('Failed to create organization invitations', {
      organizationId: (await params).id,
      error,
    })

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/organizations/[id]/invitations?invitationId=...
 * Cancel a pending invitation
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: organizationId } = await params
    const url = new URL(request.url)
    const invitationId = url.searchParams.get('invitationId')

    if (!invitationId) {
      return NextResponse.json(
        { error: 'Invitation ID is required as query parameter' },
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

    // Cancel the invitation
    const result = await db
      .update(invitation)
      .set({
        status: 'cancelled',
      })
      .where(
        and(
          eq(invitation.id, invitationId),
          eq(invitation.organizationId, organizationId),
          eq(invitation.status, 'pending')
        )
      )
      .returning()

    if (result.length === 0) {
      return NextResponse.json(
        { error: 'Invitation not found or already processed' },
        { status: 404 }
      )
    }

    logger.info('Organization invitation cancelled', {
      organizationId,
      invitationId,
      cancelledBy: session.user.id,
      email: result[0].email,
    })

    return NextResponse.json({
      success: true,
      message: 'Invitation cancelled successfully',
    })
  } catch (error) {
    logger.error('Failed to cancel organization invitation', {
      organizationId: (await params).id,
      error,
    })

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
