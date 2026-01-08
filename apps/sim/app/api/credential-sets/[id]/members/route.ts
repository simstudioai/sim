import { db } from '@sim/db'
import { account, credentialSet, credentialSetMember, member, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { hasCredentialSetsAccess } from '@/lib/billing'
import { syncAllWebhooksForCredentialSet } from '@/lib/webhooks/utils.server'

const logger = createLogger('CredentialSetMembers')

async function getCredentialSetWithAccess(credentialSetId: string, userId: string) {
  const [set] = await db
    .select({
      id: credentialSet.id,
      organizationId: credentialSet.organizationId,
      providerId: credentialSet.providerId,
    })
    .from(credentialSet)
    .where(eq(credentialSet.id, credentialSetId))
    .limit(1)

  if (!set) return null

  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, set.organizationId)))
    .limit(1)

  if (!membership) return null

  return { set, role: membership.role }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check plan access (team/enterprise) or env var override
  const hasAccess = await hasCredentialSetsAccess(session.user.id)
  if (!hasAccess) {
    return NextResponse.json(
      { error: 'Credential sets require a Team or Enterprise plan' },
      { status: 403 }
    )
  }

  const { id } = await params
  const result = await getCredentialSetWithAccess(id, session.user.id)

  if (!result) {
    return NextResponse.json({ error: 'Credential set not found' }, { status: 404 })
  }

  const members = await db
    .select({
      id: credentialSetMember.id,
      userId: credentialSetMember.userId,
      status: credentialSetMember.status,
      joinedAt: credentialSetMember.joinedAt,
      createdAt: credentialSetMember.createdAt,
      userName: user.name,
      userEmail: user.email,
      userImage: user.image,
    })
    .from(credentialSetMember)
    .leftJoin(user, eq(credentialSetMember.userId, user.id))
    .where(eq(credentialSetMember.credentialSetId, id))

  // Get credentials for all active members filtered by the polling group's provider
  const activeMembers = members.filter((m) => m.status === 'active')
  const memberUserIds = activeMembers.map((m) => m.userId)

  let credentials: { userId: string; providerId: string; accountId: string }[] = []
  if (memberUserIds.length > 0 && result.set.providerId) {
    credentials = await db
      .select({
        userId: account.userId,
        providerId: account.providerId,
        accountId: account.accountId,
      })
      .from(account)
      .where(
        and(inArray(account.userId, memberUserIds), eq(account.providerId, result.set.providerId))
      )
  }

  // Group credentials by userId
  const credentialsByUser = credentials.reduce(
    (acc, cred) => {
      if (!acc[cred.userId]) {
        acc[cred.userId] = []
      }
      acc[cred.userId].push({
        providerId: cred.providerId,
        accountId: cred.accountId,
      })
      return acc
    },
    {} as Record<string, { providerId: string; accountId: string }[]>
  )

  // Attach credentials to members
  const membersWithCredentials = members.map((m) => ({
    ...m,
    credentials: credentialsByUser[m.userId] || [],
  }))

  return NextResponse.json({ members: membersWithCredentials })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check plan access (team/enterprise) or env var override
  const hasAccess = await hasCredentialSetsAccess(session.user.id)
  if (!hasAccess) {
    return NextResponse.json(
      { error: 'Credential sets require a Team or Enterprise plan' },
      { status: 403 }
    )
  }

  const { id } = await params
  const { searchParams } = new URL(req.url)
  const memberId = searchParams.get('memberId')

  if (!memberId) {
    return NextResponse.json({ error: 'memberId is required' }, { status: 400 })
  }

  try {
    const result = await getCredentialSetWithAccess(id, session.user.id)

    if (!result) {
      return NextResponse.json({ error: 'Credential set not found' }, { status: 404 })
    }

    if (result.role !== 'admin' && result.role !== 'owner') {
      return NextResponse.json({ error: 'Admin or owner permissions required' }, { status: 403 })
    }

    const [memberToRemove] = await db
      .select()
      .from(credentialSetMember)
      .where(and(eq(credentialSetMember.id, memberId), eq(credentialSetMember.credentialSetId, id)))
      .limit(1)

    if (!memberToRemove) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    const requestId = crypto.randomUUID().slice(0, 8)

    // Use transaction to ensure member deletion + webhook sync are atomic
    await db.transaction(async (tx) => {
      await tx.delete(credentialSetMember).where(eq(credentialSetMember.id, memberId))

      const syncResult = await syncAllWebhooksForCredentialSet(id, requestId, tx)
      logger.info('Synced webhooks after member removed', {
        credentialSetId: id,
        ...syncResult,
      })
    })

    logger.info('Removed member from credential set', {
      credentialSetId: id,
      memberId,
      userId: session.user.id,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error removing member from credential set', error)
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 })
  }
}
