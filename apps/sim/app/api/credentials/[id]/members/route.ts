import { db } from '@sim/db'
import { credentialMember, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { getCredentialActorContext } from '@/lib/credentials/access'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CredentialMembersAPI')

const upsertMemberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['admin', 'member']),
})

const deleteMemberSchema = z.object({
  userId: z.string().min(1),
})

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    const access = await getCredentialActorContext(id, session.user.id)
    if (!access.credential) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }
    if (!access.hasWorkspaceAccess || !access.isAdmin) {
      return NextResponse.json({ error: 'Credential admin permission required' }, { status: 403 })
    }

    const members = await db
      .select({
        id: credentialMember.id,
        userId: credentialMember.userId,
        role: credentialMember.role,
        status: credentialMember.status,
        joinedAt: credentialMember.joinedAt,
        invitedBy: credentialMember.invitedBy,
        createdAt: credentialMember.createdAt,
        updatedAt: credentialMember.updatedAt,
        userName: user.name,
        userEmail: user.email,
        userImage: user.image,
      })
      .from(credentialMember)
      .leftJoin(user, eq(credentialMember.userId, user.id))
      .where(eq(credentialMember.credentialId, id))

    return NextResponse.json({ members }, { status: 200 })
  } catch (error) {
    logger.error('Failed to list credential members', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    const parseResult = upsertMemberSchema.safeParse(await request.json())
    if (!parseResult.success) {
      return NextResponse.json({ error: parseResult.error.errors[0]?.message }, { status: 400 })
    }

    const access = await getCredentialActorContext(id, session.user.id)
    if (!access.credential) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }
    if (!access.hasWorkspaceAccess || !access.isAdmin) {
      return NextResponse.json({ error: 'Credential admin permission required' }, { status: 403 })
    }

    const targetWorkspaceAccess = await checkWorkspaceAccess(
      access.credential.workspaceId,
      parseResult.data.userId
    )
    if (!targetWorkspaceAccess.hasAccess) {
      return NextResponse.json(
        { error: 'User must have workspace access before being added to a credential' },
        { status: 400 }
      )
    }

    const now = new Date()
    const [existingMember] = await db
      .select()
      .from(credentialMember)
      .where(
        and(
          eq(credentialMember.credentialId, id),
          eq(credentialMember.userId, parseResult.data.userId)
        )
      )
      .limit(1)

    if (existingMember) {
      await db
        .update(credentialMember)
        .set({
          role: parseResult.data.role,
          status: 'active',
          joinedAt: existingMember.joinedAt ?? now,
          invitedBy: session.user.id,
          updatedAt: now,
        })
        .where(eq(credentialMember.id, existingMember.id))
    } else {
      await db.insert(credentialMember).values({
        id: crypto.randomUUID(),
        credentialId: id,
        userId: parseResult.data.userId,
        role: parseResult.data.role,
        status: 'active',
        joinedAt: now,
        invitedBy: session.user.id,
        createdAt: now,
        updatedAt: now,
      })
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    logger.error('Failed to upsert credential member', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    const parseResult = deleteMemberSchema.safeParse({
      userId: new URL(request.url).searchParams.get('userId'),
    })
    if (!parseResult.success) {
      return NextResponse.json({ error: parseResult.error.errors[0]?.message }, { status: 400 })
    }

    const access = await getCredentialActorContext(id, session.user.id)
    if (!access.credential) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }
    if (!access.hasWorkspaceAccess || !access.isAdmin) {
      return NextResponse.json({ error: 'Credential admin permission required' }, { status: 403 })
    }

    const [memberToRevoke] = await db
      .select()
      .from(credentialMember)
      .where(
        and(
          eq(credentialMember.credentialId, id),
          eq(credentialMember.userId, parseResult.data.userId)
        )
      )
      .limit(1)

    if (!memberToRevoke) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    if (memberToRevoke.status !== 'active') {
      return NextResponse.json({ success: true }, { status: 200 })
    }

    if (memberToRevoke.role === 'admin') {
      const activeAdmins = await db
        .select({ id: credentialMember.id })
        .from(credentialMember)
        .where(
          and(
            eq(credentialMember.credentialId, id),
            eq(credentialMember.role, 'admin'),
            eq(credentialMember.status, 'active')
          )
        )

      if (activeAdmins.length <= 1) {
        return NextResponse.json(
          { error: 'Cannot revoke the last active admin from a credential' },
          { status: 400 }
        )
      }
    }

    await db
      .update(credentialMember)
      .set({
        status: 'revoked',
        updatedAt: new Date(),
      })
      .where(eq(credentialMember.id, memberToRevoke.id))

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    logger.error('Failed to revoke credential member', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
