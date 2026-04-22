import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { invitation, member, organization, user, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import {
  validateBulkInvitations,
  validateSeatAvailability,
} from '@/lib/billing/validation/seat-management'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  cancelPendingInvitation,
  createPendingInvitation,
  sendInvitationEmail,
} from '@/lib/invitations/send'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { hasWorkspaceAdminAccess } from '@/lib/workspaces/permissions/utils'
import { isOrganizationWorkspace } from '@/lib/workspaces/policy'
import {
  InvitationsNotAllowedError,
  validateInvitationsAllowed,
} from '@/ee/access-control/utils/permission-check'

const logger = createLogger('OrganizationInvitations')

interface WorkspaceGrantPayload {
  workspaceId: string
  permission: 'admin' | 'write' | 'read'
}

export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { id: organizationId } = await params

      const [memberEntry] = await db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
        .limit(1)

      if (!memberEntry) {
        return NextResponse.json(
          { error: 'Forbidden - Not a member of this organization' },
          { status: 403 }
        )
      }

      const userRole = memberEntry.role
      if (!['owner', 'admin'].includes(userRole)) {
        return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
      }

      const invitations = await db
        .select({
          id: invitation.id,
          email: invitation.email,
          kind: invitation.kind,
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
        data: { invitations, userRole },
      })
    } catch (error) {
      logger.error('Failed to get organization invitations', { error })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

export const POST = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { id: organizationId } = await params

      await validateInvitationsAllowed(session.user.id, { organizationId })

      const url = new URL(request.url)
      const validateOnly = url.searchParams.get('validate') === 'true'
      const isBatch = url.searchParams.get('batch') === 'true'

      const body = await request.json()
      const { email, emails, role = 'member', workspaceInvitations } = body
      const invitationEmails = email ? [email] : emails

      if (!invitationEmails || !Array.isArray(invitationEmails) || invitationEmails.length === 0) {
        return NextResponse.json({ error: 'Email or emails array is required' }, { status: 400 })
      }

      if (!['member', 'admin'].includes(role)) {
        return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
      }

      const [memberEntry] = await db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
        .limit(1)

      if (!memberEntry) {
        return NextResponse.json(
          { error: 'Forbidden - Not a member of this organization' },
          { status: 403 }
        )
      }

      if (!['owner', 'admin'].includes(memberEntry.role)) {
        return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
      }

      if (validateOnly) {
        const validationResult = await validateBulkInvitations(organizationId, invitationEmails)
        return NextResponse.json({
          success: true,
          data: validationResult,
          validatedBy: session.user.id,
          validatedAt: new Date().toISOString(),
        })
      }

      const [organizationEntry] = await db
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1)

      if (!organizationEntry) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
      }

      const processedEmails = Array.from(
        new Set(
          invitationEmails
            .map((raw: string) => {
              const normalized = raw.trim().toLowerCase()
              return quickValidateEmail(normalized).isValid ? normalized : null
            })
            .filter((email): email is string => !!email)
        )
      )

      if (processedEmails.length === 0) {
        return NextResponse.json({ error: 'No valid emails provided' }, { status: 400 })
      }

      const validGrants: WorkspaceGrantPayload[] = []
      if (isBatch) {
        if (!Array.isArray(workspaceInvitations) || workspaceInvitations.length === 0) {
          return NextResponse.json(
            { error: 'Select at least one organization workspace for this invitation.' },
            { status: 400 }
          )
        }

        for (const wsInvitation of workspaceInvitations) {
          const canInvite = await hasWorkspaceAdminAccess(session.user.id, wsInvitation.workspaceId)
          if (!canInvite) {
            return NextResponse.json(
              {
                error: `You don't have permission to invite users to workspace ${wsInvitation.workspaceId}`,
              },
              { status: 403 }
            )
          }

          const [workspaceEntry] = await db
            .select({
              id: workspace.id,
              organizationId: workspace.organizationId,
              workspaceMode: workspace.workspaceMode,
            })
            .from(workspace)
            .where(eq(workspace.id, wsInvitation.workspaceId))
            .limit(1)

          if (!workspaceEntry || !isOrganizationWorkspace(workspaceEntry)) {
            return NextResponse.json(
              {
                error: `Workspace ${wsInvitation.workspaceId} is not an organization-owned workspace.`,
              },
              { status: 400 }
            )
          }

          if (workspaceEntry.organizationId !== organizationId) {
            return NextResponse.json(
              {
                error: `Workspace ${wsInvitation.workspaceId} does not belong to this organization.`,
              },
              { status: 400 }
            )
          }

          await validateInvitationsAllowed(session.user.id, wsInvitation.workspaceId)

          validGrants.push({
            workspaceId: wsInvitation.workspaceId,
            permission: wsInvitation.permission,
          })
        }
      }

      const existingMembers = await db
        .select({ userEmail: user.email })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(eq(member.organizationId, organizationId))
      const existingEmails = existingMembers.map((m) => m.userEmail.toLowerCase())
      const newEmails = processedEmails.filter((email) => !existingEmails.includes(email))

      const existingInvitations = await db
        .select({ email: invitation.email })
        .from(invitation)
        .where(and(eq(invitation.organizationId, organizationId), eq(invitation.status, 'pending')))
      const pendingEmails = existingInvitations.map((i) => i.email.toLowerCase())
      const emailsToInvite = newEmails.filter((email) => !pendingEmails.includes(email))

      if (emailsToInvite.length === 0) {
        const isSingleEmail = processedEmails.length === 1
        const existingMembersEmails = processedEmails.filter((email) =>
          existingEmails.includes(email)
        )
        const pendingInvitationEmails = processedEmails.filter((email) =>
          pendingEmails.includes(email)
        )

        if (isSingleEmail) {
          if (existingMembersEmails.length > 0) {
            return NextResponse.json(
              { error: 'Failed to send invitation. User is already a part of the organization.' },
              { status: 400 }
            )
          }
          if (pendingInvitationEmails.length > 0) {
            return NextResponse.json(
              {
                error:
                  'Failed to send invitation. A pending invitation already exists for this email.',
              },
              { status: 400 }
            )
          }
        }

        return NextResponse.json(
          {
            error: 'All emails are already members or have pending invitations.',
            details: {
              existingMembers: existingMembersEmails,
              pendingInvitations: pendingInvitationEmails,
            },
          },
          { status: 400 }
        )
      }

      const seatValidation = await validateSeatAvailability(organizationId, emailsToInvite.length)
      if (!seatValidation.canInvite) {
        return NextResponse.json(
          {
            error: seatValidation.reason,
            seatInfo: {
              currentSeats: seatValidation.currentSeats,
              maxSeats: seatValidation.maxSeats,
              availableSeats: seatValidation.availableSeats,
              seatsRequested: emailsToInvite.length,
            },
          },
          { status: 400 }
        )
      }

      const [inviterRow] = await db
        .select({ name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, session.user.id))
        .limit(1)
      const inviterName = inviterRow?.name || inviterRow?.email || 'A user'

      const sentInvitations: Array<{ id: string; email: string }> = []
      const failedInvitations: Array<{ email: string; error: string }> = []

      for (const email of emailsToInvite) {
        try {
          const { invitationId, token } = await createPendingInvitation({
            kind: 'organization',
            email,
            inviterId: session.user.id,
            organizationId,
            role: role as 'admin' | 'member',
            grants: validGrants,
          })

          const emailResult = await sendInvitationEmail({
            invitationId,
            token,
            kind: 'organization',
            email,
            inviterName,
            organizationId,
            organizationRole: role as 'admin' | 'member',
            grants: validGrants,
          })

          if (!emailResult.success) {
            logger.error('Failed to send organization invitation email', {
              email,
              error: emailResult.error,
            })
            failedInvitations.push({
              email,
              error: emailResult.error || 'Unknown email delivery error',
            })
            await cancelPendingInvitation(invitationId)
            continue
          }

          sentInvitations.push({ id: invitationId, email })
        } catch (creationError) {
          logger.error('Failed to create organization invitation', { email, error: creationError })
          failedInvitations.push({
            email,
            error:
              creationError instanceof Error
                ? creationError.message
                : 'Failed to create invitation',
          })
        }
      }

      for (const inv of sentInvitations) {
        recordAudit({
          workspaceId: null,
          actorId: session.user.id,
          action: AuditAction.ORG_INVITATION_CREATED,
          resourceType: AuditResourceType.ORGANIZATION,
          resourceId: organizationId,
          actorName: session.user.name ?? undefined,
          actorEmail: session.user.email ?? undefined,
          resourceName: organizationEntry.name,
          description: `Invited ${inv.email} to organization as ${role}`,
          metadata: {
            invitationId: inv.id,
            targetEmail: inv.email,
            targetRole: role,
            isBatch,
            workspaceGrantCount: validGrants.length,
          },
          request,
        })
      }

      const sentEmails = sentInvitations.map((inv) => inv.email)
      const responseData = {
        invitationsSent: sentInvitations.length,
        invitedEmails: sentEmails,
        failedInvitations,
        existingMembers: processedEmails.filter((email) => existingEmails.includes(email)),
        pendingInvitations: processedEmails.filter((email) => pendingEmails.includes(email)),
        invalidEmails: invitationEmails.filter(
          (email: string) => !quickValidateEmail(email.trim().toLowerCase()).isValid
        ),
        workspaceGrantsPerInvite: validGrants.length,
        seatInfo: {
          seatsUsed: seatValidation.currentSeats + sentInvitations.length,
          maxSeats: seatValidation.maxSeats,
          availableSeats: seatValidation.availableSeats - sentInvitations.length,
        },
      }

      if (failedInvitations.length > 0 && sentInvitations.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'Failed to send invitation emails.',
            message: 'No invitation emails could be delivered.',
            data: responseData,
          },
          { status: 502 }
        )
      }

      if (failedInvitations.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'Some invitation emails failed to send.',
            message: `${sentInvitations.length} invitation(s) sent, ${failedInvitations.length} failed`,
            data: responseData,
          },
          { status: 207 }
        )
      }

      return NextResponse.json({
        success: true,
        message: `${sentInvitations.length} invitation(s) sent successfully`,
        data: responseData,
      })
    } catch (error) {
      if (error instanceof InvitationsNotAllowedError) {
        return NextResponse.json({ error: error.message }, { status: 403 })
      }
      logger.error('Failed to create organization invitations', { error })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
