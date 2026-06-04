import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import {
  credentialSet,
  credentialSetInvitation,
  credentialSetMember,
  organization,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  acceptCredentialSetInvitationContract,
  getCredentialSetInvitationContract,
} from '@/lib/api/contracts/credential-sets'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { normalizeEmail } from '@/lib/invitations/core'
import { syncAllWebhooksForCredentialSet } from '@/lib/webhooks/utils.server'

const logger = createLogger('CredentialSetInviteToken')

export const GET = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ token: string }> }) => {
    const parsed = await parseRequest(getCredentialSetInvitationContract, req, context)
    if (!parsed.success) return parsed.response
    const { token } = parsed.data.params

    const [invitation] = await db
      .select({
        id: credentialSetInvitation.id,
        credentialSetId: credentialSetInvitation.credentialSetId,
        email: credentialSetInvitation.email,
        status: credentialSetInvitation.status,
        expiresAt: credentialSetInvitation.expiresAt,
        credentialSetName: credentialSet.name,
        providerId: credentialSet.providerId,
        organizationId: credentialSet.organizationId,
        organizationName: organization.name,
      })
      .from(credentialSetInvitation)
      .innerJoin(credentialSet, eq(credentialSetInvitation.credentialSetId, credentialSet.id))
      .innerJoin(organization, eq(credentialSet.organizationId, organization.id))
      .where(eq(credentialSetInvitation.token, token))
      .limit(1)

    if (!invitation) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
    }

    if (invitation.status !== 'pending') {
      return NextResponse.json({ error: 'Invitation is no longer valid' }, { status: 410 })
    }

    if (new Date() > invitation.expiresAt) {
      await db
        .update(credentialSetInvitation)
        .set({ status: 'expired' })
        .where(eq(credentialSetInvitation.id, invitation.id))

      return NextResponse.json({ error: 'Invitation has expired' }, { status: 410 })
    }

    return NextResponse.json({
      invitation: {
        credentialSetName: invitation.credentialSetName,
        organizationName: invitation.organizationName,
        providerId: invitation.providerId,
        email: invitation.email,
      },
    })
  }
)

export const POST = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ token: string }> }) => {
    const parsed = await parseRequest(acceptCredentialSetInvitationContract, req, context)
    if (!parsed.success) return parsed.response
    const { token } = parsed.data.params

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    try {
      const [invitationData] = await db
        .select({
          id: credentialSetInvitation.id,
          credentialSetId: credentialSetInvitation.credentialSetId,
          email: credentialSetInvitation.email,
          status: credentialSetInvitation.status,
          expiresAt: credentialSetInvitation.expiresAt,
          invitedBy: credentialSetInvitation.invitedBy,
          credentialSetName: credentialSet.name,
          providerId: credentialSet.providerId,
        })
        .from(credentialSetInvitation)
        .innerJoin(credentialSet, eq(credentialSetInvitation.credentialSetId, credentialSet.id))
        .where(eq(credentialSetInvitation.token, token))
        .limit(1)

      if (!invitationData) {
        return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
      }

      const invitation = invitationData

      if (invitation.status !== 'pending') {
        return NextResponse.json({ error: 'Invitation is no longer valid' }, { status: 410 })
      }

      if (new Date() > invitation.expiresAt) {
        await db
          .update(credentialSetInvitation)
          .set({ status: 'expired' })
          .where(eq(credentialSetInvitation.id, invitation.id))

        return NextResponse.json({ error: 'Invitation has expired' }, { status: 410 })
      }

      if (invitation.email) {
        const sessionEmail = session.user.email
        if (!sessionEmail || normalizeEmail(sessionEmail) !== normalizeEmail(invitation.email)) {
          logger.warn('Rejected credential set invitation accept due to email mismatch', {
            invitationId: invitation.id,
            credentialSetId: invitation.credentialSetId,
            userId: session.user.id,
          })
          return NextResponse.json(
            { error: 'This invitation was sent to a different email address' },
            { status: 403 }
          )
        }
      }

      const existingMember = await db
        .select()
        .from(credentialSetMember)
        .where(
          and(
            eq(credentialSetMember.credentialSetId, invitation.credentialSetId),
            eq(credentialSetMember.userId, session.user.id)
          )
        )
        .limit(1)

      if (existingMember.length > 0) {
        return NextResponse.json(
          { error: 'Already a member of this credential set' },
          { status: 409 }
        )
      }

      const now = new Date()
      const requestId = generateId().slice(0, 8)

      await db.transaction(async (tx) => {
        await tx.insert(credentialSetMember).values({
          id: generateId(),
          credentialSetId: invitation.credentialSetId,
          userId: session.user.id,
          status: 'active',
          joinedAt: now,
          invitedBy: invitation.invitedBy,
          createdAt: now,
          updatedAt: now,
        })

        await tx
          .update(credentialSetInvitation)
          .set({
            status: 'accepted',
            acceptedAt: now,
            acceptedByUserId: session.user.id,
          })
          .where(eq(credentialSetInvitation.id, invitation.id))

        if (invitation.email) {
          await tx
            .update(credentialSetInvitation)
            .set({
              status: 'accepted',
              acceptedAt: now,
              acceptedByUserId: session.user.id,
            })
            .where(
              and(
                eq(credentialSetInvitation.credentialSetId, invitation.credentialSetId),
                eq(credentialSetInvitation.email, invitation.email),
                eq(credentialSetInvitation.status, 'pending')
              )
            )
        }

        const syncResult = await syncAllWebhooksForCredentialSet(
          invitation.credentialSetId,
          requestId,
          tx
        )
        logger.info('Synced webhooks after member joined', {
          credentialSetId: invitation.credentialSetId,
          ...syncResult,
        })
      })

      logger.info('Accepted credential set invitation', {
        invitationId: invitation.id,
        credentialSetId: invitation.credentialSetId,
        userId: session.user.id,
      })

      recordAudit({
        actorId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: AuditAction.CREDENTIAL_SET_INVITATION_ACCEPTED,
        resourceType: AuditResourceType.CREDENTIAL_SET,
        resourceId: invitation.credentialSetId,
        resourceName: invitation.credentialSetName,
        description: `Accepted credential set invitation`,
        metadata: {
          invitationId: invitation.id,
          credentialSetId: invitation.credentialSetId,
          providerId: invitation.providerId,
          credentialSetName: invitation.credentialSetName,
        },
        request: req,
      })

      return NextResponse.json({
        success: true,
        credentialSetId: invitation.credentialSetId,
        providerId: invitation.providerId,
      })
    } catch (error) {
      logger.error('Error accepting invitation', error)
      return NextResponse.json({ error: 'Failed to accept invitation' }, { status: 500 })
    }
  }
)
