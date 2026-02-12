import { db } from '@sim/db'
import { credential, credentialMember, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'

const logger = createLogger('CredentialMembersAPI')

interface RouteContext {
  params: Promise<{ id: string }>
}

async function requireAdminMembership(credentialId: string, userId: string) {
  const [membership] = await db
    .select({ role: credentialMember.role, status: credentialMember.status })
    .from(credentialMember)
    .where(
      and(eq(credentialMember.credentialId, credentialId), eq(credentialMember.userId, userId))
    )
    .limit(1)

  if (!membership || membership.status !== 'active' || membership.role !== 'admin') {
    return null
  }
  return membership
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: credentialId } = await context.params

    const [cred] = await db
      .select({ id: credential.id })
      .from(credential)
      .where(eq(credential.id, credentialId))
      .limit(1)

    if (!cred) {
      return NextResponse.json({ members: [] }, { status: 200 })
    }

    const members = await db
      .select({
        id: credentialMember.id,
        userId: credentialMember.userId,
        role: credentialMember.role,
        status: credentialMember.status,
        joinedAt: credentialMember.joinedAt,
        userName: user.name,
        userEmail: user.email,
      })
      .from(credentialMember)
      .innerJoin(user, eq(credentialMember.userId, user.id))
      .where(eq(credentialMember.credentialId, credentialId))

    return NextResponse.json({ members })
  } catch (error) {
    logger.error('Failed to fetch credential members', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const addMemberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['admin', 'member']).default('member'),
})

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: credentialId } = await context.params

    const admin = await requireAdminMembership(credentialId, session.user.id)
    if (!admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = addMemberSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { userId, role } = parsed.data
    const now = new Date()

    const [existing] = await db
      .select({ id: credentialMember.id, status: credentialMember.status })
      .from(credentialMember)
      .where(
        and(eq(credentialMember.credentialId, credentialId), eq(credentialMember.userId, userId))
      )
      .limit(1)

    if (existing) {
      await db
        .update(credentialMember)
        .set({ role, status: 'active', updatedAt: now })
        .where(eq(credentialMember.id, existing.id))
      return NextResponse.json({ success: true })
    }

    await db.insert(credentialMember).values({
      id: crypto.randomUUID(),
      credentialId,
      userId,
      role,
      status: 'active',
      joinedAt: now,
      invitedBy: session.user.id,
      createdAt: now,
      updatedAt: now,
    })

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error) {
    logger.error('Failed to add credential member', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: credentialId } = await context.params
    const targetUserId = new URL(request.url).searchParams.get('userId')
    if (!targetUserId) {
      return NextResponse.json({ error: 'userId query parameter required' }, { status: 400 })
    }

    const admin = await requireAdminMembership(credentialId, session.user.id)
    if (!admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const [target] = await db
      .select({
        id: credentialMember.id,
        role: credentialMember.role,
        status: credentialMember.status,
      })
      .from(credentialMember)
      .where(
        and(
          eq(credentialMember.credentialId, credentialId),
          eq(credentialMember.userId, targetUserId)
        )
      )
      .limit(1)

    if (!target) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    if (target.role === 'admin') {
      const activeAdmins = await db
        .select({ id: credentialMember.id })
        .from(credentialMember)
        .where(
          and(
            eq(credentialMember.credentialId, credentialId),
            eq(credentialMember.role, 'admin'),
            eq(credentialMember.status, 'active')
          )
        )

      if (activeAdmins.length <= 1) {
        return NextResponse.json({ error: 'Cannot remove the last admin' }, { status: 400 })
      }
    }

    await db
      .update(credentialMember)
      .set({ status: 'revoked', updatedAt: new Date() })
      .where(eq(credentialMember.id, target.id))

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Failed to remove credential member', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
