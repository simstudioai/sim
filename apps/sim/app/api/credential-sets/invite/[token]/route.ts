import { db } from '@sim/db'
import {
  credentialSet,
  credentialSetInvitation,
  credentialSetMember,
  organization,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { syncAllWebhooksForCredentialSet } from '@/lib/webhooks/utils.server'

const logger = createLogger('CredentialSetInviteToken')

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

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

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

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
    const requestId = crypto.randomUUID().slice(0, 8)

    // Use transaction to ensure membership + invitation update + webhook sync are atomic
    await db.transaction(async (tx) => {
      await tx.insert(credentialSetMember).values({
        id: crypto.randomUUID(),
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

      // Clean up all other pending invitations for the same credential set and email
      // This prevents duplicate invites from showing up after accepting one
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

      // Sync webhooks within the transaction
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
