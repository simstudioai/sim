import { db } from '@sim/db'
import { credentialSet, credentialSetMember, member, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

const logger = createLogger('CredentialSetMembers')

async function getCredentialSetWithAccess(credentialSetId: string, userId: string) {
  const [set] = await db
    .select({
      id: credentialSet.id,
      organizationId: credentialSet.organizationId,
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

  return NextResponse.json({ members })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

    if (result.role !== 'admin') {
      return NextResponse.json({ error: 'Admin permissions required' }, { status: 403 })
    }

    const [memberToRemove] = await db
      .select()
      .from(credentialSetMember)
      .where(and(eq(credentialSetMember.id, memberId), eq(credentialSetMember.credentialSetId, id)))
      .limit(1)

    if (!memberToRemove) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    await db.delete(credentialSetMember).where(eq(credentialSetMember.id, memberId))

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
