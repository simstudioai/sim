import { db } from '@sim/db'
import { credentialSet, credentialSetMember, organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

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
