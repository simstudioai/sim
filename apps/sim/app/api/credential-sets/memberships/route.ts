import { db } from '@sim/db'
import { credentialSet, credentialSetMember, organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { syncAllWebhooksForCredentialSet } from '@/lib/webhooks/utils.server'

const logger = createLogger('CredentialSetMemberships')

export async function GET() {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const memberships = await db
      .select({
        membershipId: credentialSetMember.id,
        status: credentialSetMember.status,
        joinedAt: credentialSetMember.joinedAt,
        credentialSetId: credentialSet.id,
        credentialSetName: credentialSet.name,
        credentialSetDescription: credentialSet.description,
        providerId: credentialSet.providerId,
        organizationId: organization.id,
        organizationName: organization.name,
      })
      .from(credentialSetMember)
      .innerJoin(credentialSet, eq(credentialSetMember.credentialSetId, credentialSet.id))
      .innerJoin(organization, eq(credentialSet.organizationId, organization.id))
      .where(eq(credentialSetMember.userId, session.user.id))

    return NextResponse.json({ memberships })
  } catch (error) {
    logger.error('Error fetching credential set memberships', error)
    return NextResponse.json({ error: 'Failed to fetch memberships' }, { status: 500 })
  }
}

/**
 * Leave a credential set (self-revocation).
 * Sets status to 'revoked' immediately (blocks execution), then syncs webhooks to clean up.
 */
export async function DELETE(req: NextRequest) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const credentialSetId = searchParams.get('credentialSetId')

  if (!credentialSetId) {
    return NextResponse.json({ error: 'credentialSetId is required' }, { status: 400 })
  }

  try {
    const requestId = crypto.randomUUID().slice(0, 8)

    // Use transaction to ensure revocation + webhook sync are atomic
    await db.transaction(async (tx) => {
      // Find and verify membership
      const [membership] = await tx
        .select()
        .from(credentialSetMember)
        .where(
          and(
            eq(credentialSetMember.credentialSetId, credentialSetId),
            eq(credentialSetMember.userId, session.user.id)
          )
        )
        .limit(1)

      if (!membership) {
        throw new Error('Not a member of this credential set')
      }

      if (membership.status === 'revoked') {
        throw new Error('Already left this credential set')
      }

      // Set status to 'revoked' - this immediately blocks credential from being used
      await tx
        .update(credentialSetMember)
        .set({
          status: 'revoked',
          updatedAt: new Date(),
        })
        .where(eq(credentialSetMember.id, membership.id))

      // Sync webhooks to remove this user's credential webhooks
      const syncResult = await syncAllWebhooksForCredentialSet(credentialSetId, requestId, tx)
      logger.info('Synced webhooks after member left', {
        credentialSetId,
        userId: session.user.id,
        ...syncResult,
      })
    })

    logger.info('User left credential set', {
      credentialSetId,
      userId: session.user.id,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to leave credential set'
    logger.error('Error leaving credential set', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
