import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import {
  invitation,
  invitationWorkspaceGrant,
  member,
  organization,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { getErrorMessage } from '@sim/utils/errors'
import { normalizeEmail } from '@sim/utils/string'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  inviteOrganizationMembersContract,
  organizationParamsSchema,
} from '@/lib/api/contracts/organization'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { isEnterprise } from '@/lib/billing/plan-helpers'
import {
  validateBulkInvitations,
  validateSeatAvailability,
} from '@/lib/billing/validation/seat-management'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { grantWorkspaceAccessDirectly } from '@/lib/invitations/direct-grant'
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

      const paramsResult = organizationParamsSchema.safeParse(await params)
      if (!paramsResult.success) {
        return NextResponse.json(
          { error: getValidationErrorMessage(paramsResult.error, 'Invalid route parameters') },
          { status: 400 }
        )
      }

      const { id: organizationId } = paramsResult.data

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
      if (!isOrgAdminRole(userRole)) {
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
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(inviteOrganizationMembersContract, request, context)
      if (!parsed.success) return parsed.response

      const { id: organizationId } = parsed.data.params

      await validateInvitationsAllowed(session.user.id, { organizationId })

      const validateOnly = parsed.data.query.validate === true
      const isBatch = parsed.data.query.batch === true

      const { email, emails, role = 'member', workspaceInvitations } = parsed.data.body
      const invitationEmails = email ? [email] : emails

      if (!invitationEmails || !Array.isArray(invitationEmails) || invitationEmails.length === 0) {
        return NextResponse.json({ error: 'Email or emails array is required' }, { status: 400 })
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

      if (!isOrgAdminRole(memberEntry.role)) {
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
            .map((raw) => {
              const normalized = normalizeEmail(raw)
              return quickValidateEmail(normalized).isValid ? normalized : null
            })
            .filter((email): email is string => !!email)
        )
      )

      if (processedEmails.length === 0) {
        return NextResponse.json({ error: 'No valid emails provided' }, { status: 400 })
      }

      const validGrants: WorkspaceGrantPayload[] = []
      const workspaceNameById = new Map<string, string>()
      if (isBatch) {
        if (!Array.isArray(workspaceInvitations) || workspaceInvitations.length === 0) {
          return NextResponse.json(
            { error: 'Select at least one organization workspace for this invitation.' },
            { status: 400 }
          )
        }

        for (const wsInvitation of workspaceInvitations) {
          if (validGrants.some((grant) => grant.workspaceId === wsInvitation.workspaceId)) {
            continue
          }

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
              name: workspace.name,
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

          workspaceNameById.set(workspaceEntry.id, workspaceEntry.name)
          validGrants.push({
            workspaceId: wsInvitation.workspaceId,
            permission: wsInvitation.permission,
          })
        }
      }

      const existingMembers = await db
        .select({ userId: member.userId, userEmail: user.email })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(eq(member.organizationId, organizationId))
      const memberUserIdByEmail = new Map(
        existingMembers.map((m) => [m.userEmail.toLowerCase(), m.userId])
      )
      const newEmails = processedEmails.filter((email) => !memberUserIdByEmail.has(email))
      const memberEmails = processedEmails.filter((email) => memberUserIdByEmail.has(email))

      const existingInvitations = await db
        .select({ email: invitation.email })
        .from(invitation)
        .where(and(eq(invitation.organizationId, organizationId), eq(invitation.status, 'pending')))
      const pendingEmails = existingInvitations.map((i) => i.email.toLowerCase())
      const emailsToInvite = newEmails.filter((email) => !pendingEmails.includes(email))

      /**
       * Existing organization members are not re-invited to the organization,
       * but in batch mode they still receive a workspace invitation covering
       * the selected workspaces they don't already have access to (or a
       * pending invitation for). The inviter's own email is always treated as
       * covered.
       */
      const memberWorkspaceInvites: Array<{ email: string; grants: WorkspaceGrantPayload[] }> = []
      const membersAlreadyCovered: string[] = []

      if (isBatch) {
        const inviterEmail = session.user.email?.toLowerCase() ?? null
        const eligibleMemberEmails = memberEmails.filter((email) => email !== inviterEmail)
        membersAlreadyCovered.push(...memberEmails.filter((email) => email === inviterEmail))

        const grantWorkspaceIds = validGrants.map((grant) => grant.workspaceId)
        const eligibleMemberUserIds = eligibleMemberEmails.map(
          (email) => memberUserIdByEmail.get(email) as string
        )

        const accessibleRows =
          eligibleMemberUserIds.length > 0
            ? await db
                .select({ userId: permissions.userId, workspaceId: permissions.entityId })
                .from(permissions)
                .where(
                  and(
                    eq(permissions.entityType, 'workspace'),
                    inArray(permissions.userId, eligibleMemberUserIds),
                    inArray(permissions.entityId, grantWorkspaceIds)
                  )
                )
            : []
        const accessibleByUserId = new Map<string, Set<string>>()
        for (const row of accessibleRows) {
          const workspaceIds = accessibleByUserId.get(row.userId) ?? new Set<string>()
          workspaceIds.add(row.workspaceId)
          accessibleByUserId.set(row.userId, workspaceIds)
        }

        const pendingGrantRows =
          eligibleMemberEmails.length > 0
            ? await db
                .select({
                  email: invitation.email,
                  workspaceId: invitationWorkspaceGrant.workspaceId,
                })
                .from(invitationWorkspaceGrant)
                .innerJoin(invitation, eq(invitation.id, invitationWorkspaceGrant.invitationId))
                .where(
                  and(
                    inArray(invitationWorkspaceGrant.workspaceId, grantWorkspaceIds),
                    inArray(invitation.email, eligibleMemberEmails),
                    eq(invitation.status, 'pending')
                  )
                )
            : []
        const pendingWorkspaceIdsByEmail = new Map<string, Set<string>>()
        for (const row of pendingGrantRows) {
          const email = row.email.toLowerCase()
          const workspaceIds = pendingWorkspaceIdsByEmail.get(email) ?? new Set<string>()
          workspaceIds.add(row.workspaceId)
          pendingWorkspaceIdsByEmail.set(email, workspaceIds)
        }

        for (const email of eligibleMemberEmails) {
          const memberUserId = memberUserIdByEmail.get(email) as string
          const accessibleWorkspaceIds = accessibleByUserId.get(memberUserId)
          const pendingWorkspaceIds = pendingWorkspaceIdsByEmail.get(email)

          const grantsNeeded = validGrants.filter(
            (grant) =>
              !accessibleWorkspaceIds?.has(grant.workspaceId) &&
              !pendingWorkspaceIds?.has(grant.workspaceId)
          )

          if (grantsNeeded.length > 0) {
            memberWorkspaceInvites.push({ email, grants: grantsNeeded })
          } else {
            membersAlreadyCovered.push(email)
          }
        }
      } else {
        membersAlreadyCovered.push(...memberEmails)
      }

      if (emailsToInvite.length === 0 && memberWorkspaceInvites.length === 0) {
        const isSingleEmail = processedEmails.length === 1
        const pendingInvitationEmails = processedEmails.filter((email) =>
          pendingEmails.includes(email)
        )

        if (isSingleEmail) {
          if (membersAlreadyCovered.length > 0) {
            return NextResponse.json(
              {
                error: isBatch
                  ? 'Failed to send invitation. User already has access or a pending invitation to every selected workspace.'
                  : 'Failed to send invitation. User is already a part of the organization.',
              },
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
            error: isBatch
              ? 'All emails are already members with access to the selected workspaces or have pending invitations.'
              : 'All emails are already members or have pending invitations.',
            details: {
              existingMembers: membersAlreadyCovered,
              pendingInvitations: pendingInvitationEmails,
            },
          },
          { status: 400 }
        )
      }

      const orgSubscription = await getOrganizationSubscription(organizationId)
      const enforceFixedSeats = !!orgSubscription && isEnterprise(orgSubscription.plan)
      const seatValidation =
        enforceFixedSeats && emailsToInvite.length > 0
          ? await validateSeatAvailability(organizationId, emailsToInvite.length)
          : null
      if (seatValidation && !seatValidation.canInvite) {
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

      const failedInvitations: Array<{ email: string; error: string }> = []

      /**
       * Brand-new emails receive an organization invitation (with all selected
       * workspace grants) that still requires acceptance — accepting is what
       * joins them to the org and consumes a seat.
       */
      const sentInvitations: Array<{ id: string; email: string; workspaceIds: string[] }> = []

      for (const email of emailsToInvite) {
        try {
          const { invitationId, token } = await createPendingInvitation({
            kind: 'organization',
            email,
            inviterId: session.user.id,
            organizationId,
            membershipIntent: 'internal',
            role,
            grants: validGrants,
          })

          const emailResult = await sendInvitationEmail({
            invitationId,
            token,
            kind: 'organization',
            email,
            inviterName,
            organizationId,
            organizationRole: role,
            grants: validGrants,
          })

          if (!emailResult.success) {
            logger.error('Failed to send invitation email', {
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

          sentInvitations.push({
            id: invitationId,
            email,
            workspaceIds: validGrants.map((grant) => grant.workspaceId),
          })
        } catch (creationError) {
          logger.error('Failed to create invitation', {
            email,
            error: creationError,
          })
          failedInvitations.push({
            email,
            error: getErrorMessage(creationError, 'Failed to create invitation'),
          })
        }
      }

      /**
       * Existing organization members are granted workspace access directly —
       * no invitation, no acceptance step. They are already in the org, so no
       * seat is consumed. The grant is idempotent and upgrades lower access.
       */
      const directlyAdded: string[] = []

      for (const memberInvite of memberWorkspaceInvites) {
        const memberUserId = memberUserIdByEmail.get(memberInvite.email)
        if (!memberUserId) continue

        let addedAny = false
        let lastGrantError: string | null = null
        for (const grant of memberInvite.grants) {
          try {
            const grantResult = await grantWorkspaceAccessDirectly({
              userId: memberUserId,
              email: memberInvite.email,
              workspaceId: grant.workspaceId,
              workspaceName: workspaceNameById.get(grant.workspaceId) ?? 'a workspace',
              permission: grant.permission,
              organizationId,
              actorId: session.user.id,
              actorName: inviterName,
              actorEmail: session.user.email,
              request,
            })

            if (grantResult.outcome === 'added') addedAny = true
          } catch (grantError) {
            logger.error('Failed to grant workspace access directly', {
              email: memberInvite.email,
              workspaceId: grant.workspaceId,
              error: grantError,
            })
            lastGrantError = getErrorMessage(grantError, 'Failed to add member to workspace')
          }
        }

        if (addedAny) {
          directlyAdded.push(memberInvite.email)
        } else if (lastGrantError) {
          failedInvitations.push({ email: memberInvite.email, error: lastGrantError })
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
            enforcedFixedSeats: enforceFixedSeats,
            plan: orgSubscription?.plan ?? null,
          },
          request,
        })
      }

      const totalInvitationsSent = sentInvitations.length
      const totalSucceeded = totalInvitationsSent + directlyAdded.length
      const responseData = {
        invitationsSent: totalInvitationsSent,
        invitedEmails: sentInvitations.map((inv) => inv.email),
        directlyAdded,
        directlyAddedCount: directlyAdded.length,
        failedInvitations,
        existingMembers: membersAlreadyCovered,
        pendingInvitations: processedEmails.filter(
          (email) => pendingEmails.includes(email) && !memberUserIdByEmail.has(email)
        ),
        invalidEmails: invitationEmails.filter(
          (email) => !quickValidateEmail(normalizeEmail(email)).isValid
        ),
        workspaceGrantsPerInvite: validGrants.length,
        ...(seatValidation
          ? {
              seatInfo: {
                seatsUsed: seatValidation.currentSeats + totalInvitationsSent,
                maxSeats: seatValidation.maxSeats,
                availableSeats: seatValidation.availableSeats - totalInvitationsSent,
              },
            }
          : {}),
      }

      const summaryParts: string[] = []
      if (totalInvitationsSent > 0) summaryParts.push(`${totalInvitationsSent} invitation(s) sent`)
      if (directlyAdded.length > 0) summaryParts.push(`${directlyAdded.length} member(s) added`)
      const summary = summaryParts.join(', ')

      if (failedInvitations.length > 0 && totalSucceeded === 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'Failed to send invitations.',
            message: 'No invitations could be delivered.',
            data: responseData,
          },
          { status: 502 }
        )
      }

      if (failedInvitations.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'Some invitations failed.',
            message: `${summary}, ${failedInvitations.length} failed`,
            data: responseData,
          },
          { status: 207 }
        )
      }

      return NextResponse.json({
        success: true,
        message: `${summary || 'No changes'} successfully`,
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
