import { db } from '@sim/db'
import { credentialSet, credentialSetInvitation, organization, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, gt, isNull, or } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

const logger = createLogger('CredentialSetInvitations')

export async function GET() {
  const session = await getSession()

  if (!session?.user?.id || !session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const invitations = await db
      .select({
        invitationId: credentialSetInvitation.id,
        token: credentialSetInvitation.token,
        status: credentialSetInvitation.status,
        expiresAt: credentialSetInvitation.expiresAt,
        createdAt: credentialSetInvitation.createdAt,
        credentialSetId: credentialSet.id,
        credentialSetName: credentialSet.name,
        providerId: credentialSet.providerId,
        organizationId: organization.id,
        organizationName: organization.name,
        invitedByName: user.name,
        invitedByEmail: user.email,
      })
      .from(credentialSetInvitation)
      .innerJoin(credentialSet, eq(credentialSetInvitation.credentialSetId, credentialSet.id))
      .innerJoin(organization, eq(credentialSet.organizationId, organization.id))
      .leftJoin(user, eq(credentialSetInvitation.invitedBy, user.id))
      .where(
        and(
          or(
            eq(credentialSetInvitation.email, session.user.email),
            isNull(credentialSetInvitation.email)
          ),
          eq(credentialSetInvitation.status, 'pending'),
          gt(credentialSetInvitation.expiresAt, new Date())
        )
      )

    return NextResponse.json({ invitations })
  } catch (error) {
    logger.error('Error fetching credential set invitations', error)
    return NextResponse.json({ error: 'Failed to fetch invitations' }, { status: 500 })
  }
}
