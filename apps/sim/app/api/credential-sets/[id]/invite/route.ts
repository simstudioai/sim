import { db } from '@sim/db'
import { credentialSet, credentialSetInvitation, member } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'

const logger = createLogger('CredentialSetInvite')

const createInviteSchema = z.object({
  email: z.string().email().optional(),
})

async function getCredentialSetWithAccess(credentialSetId: string, userId: string) {
  const [set] = await db
    .select({
      id: credentialSet.id,
      organizationId: credentialSet.organizationId,
      name: credentialSet.name,
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

  const invitations = await db
    .select()
    .from(credentialSetInvitation)
    .where(eq(credentialSetInvitation.credentialSetId, id))

  return NextResponse.json({ invitations })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    const result = await getCredentialSetWithAccess(id, session.user.id)

    if (!result) {
      return NextResponse.json({ error: 'Credential set not found' }, { status: 404 })
    }

    if (result.role !== 'admin') {
      return NextResponse.json({ error: 'Admin permissions required' }, { status: 403 })
    }

    const body = await req.json()
    const { email } = createInviteSchema.parse(body)

    const token = crypto.randomUUID()
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

    const invitation = {
      id: crypto.randomUUID(),
      credentialSetId: id,
      email: email || null,
      token,
      invitedBy: session.user.id,
      status: 'pending' as const,
      expiresAt,
      createdAt: new Date(),
    }

    await db.insert(credentialSetInvitation).values(invitation)

    const inviteUrl = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/credential-account/${token}`

    logger.info('Created credential set invitation', {
      credentialSetId: id,
      invitationId: invitation.id,
      userId: session.user.id,
    })

    return NextResponse.json({
      invitation: {
        ...invitation,
        inviteUrl,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    logger.error('Error creating invitation', error)
    return NextResponse.json({ error: 'Failed to create invitation' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const { searchParams } = new URL(req.url)
  const invitationId = searchParams.get('invitationId')

  if (!invitationId) {
    return NextResponse.json({ error: 'invitationId is required' }, { status: 400 })
  }

  try {
    const result = await getCredentialSetWithAccess(id, session.user.id)

    if (!result) {
      return NextResponse.json({ error: 'Credential set not found' }, { status: 404 })
    }

    if (result.role !== 'admin') {
      return NextResponse.json({ error: 'Admin permissions required' }, { status: 403 })
    }

    await db
      .update(credentialSetInvitation)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(credentialSetInvitation.id, invitationId),
          eq(credentialSetInvitation.credentialSetId, id)
        )
      )

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error cancelling invitation', error)
    return NextResponse.json({ error: 'Failed to cancel invitation' }, { status: 500 })
  }
}
