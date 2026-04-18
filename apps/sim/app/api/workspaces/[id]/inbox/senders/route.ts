import { db, mothershipInboxAllowedSender, permissions, user } from '@sim/db'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { hasInboxAccess } from '@/lib/billing/core/subscription'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('InboxSendersAPI')

const addSenderSchema = z.object({
  email: z.string().email('Invalid email address'),
  label: z.string().max(100).optional(),
})

const deleteSenderSchema = z.object({
  senderId: z.string().min(1),
})

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: workspaceId } = await params
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [hasAccess, permission] = await Promise.all([
    hasInboxAccess(session.user.id),
    getUserEntityPermissions(session.user.id, 'workspace', workspaceId),
  ])
  if (!hasAccess) {
    return NextResponse.json({ error: 'Sim Mailer requires a Max plan' }, { status: 403 })
  }
  if (!permission) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const [senders, members] = await Promise.all([
    db
      .select({
        id: mothershipInboxAllowedSender.id,
        email: mothershipInboxAllowedSender.email,
        label: mothershipInboxAllowedSender.label,
        createdAt: mothershipInboxAllowedSender.createdAt,
      })
      .from(mothershipInboxAllowedSender)
      .where(eq(mothershipInboxAllowedSender.workspaceId, workspaceId))
      .orderBy(mothershipInboxAllowedSender.createdAt),
    db
      .select({
        email: user.email,
        name: user.name,
      })
      .from(permissions)
      .innerJoin(user, eq(permissions.userId, user.id))
      .where(and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspaceId))),
  ])

  return NextResponse.json({
    senders: senders.map((s) => ({
      id: s.id,
      email: s.email,
      label: s.label,
      createdAt: s.createdAt,
    })),
    workspaceMembers: members.map((m) => ({
      email: m.email,
      name: m.name,
      isAutoAllowed: true,
    })),
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: workspaceId } = await params
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [hasAccess, permission] = await Promise.all([
    hasInboxAccess(session.user.id),
    getUserEntityPermissions(session.user.id, 'workspace', workspaceId),
  ])
  if (!hasAccess) {
    return NextResponse.json({ error: 'Sim Mailer requires a Max plan' }, { status: 403 })
  }
  if (permission !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  try {
    const { email, label } = addSenderSchema.parse(await req.json())
    const normalizedEmail = email.toLowerCase()

    const [existing] = await db
      .select({ id: mothershipInboxAllowedSender.id })
      .from(mothershipInboxAllowedSender)
      .where(
        and(
          eq(mothershipInboxAllowedSender.workspaceId, workspaceId),
          eq(mothershipInboxAllowedSender.email, normalizedEmail)
        )
      )
      .limit(1)

    if (existing) {
      return NextResponse.json({ error: 'Sender already exists' }, { status: 409 })
    }

    const [sender] = await db
      .insert(mothershipInboxAllowedSender)
      .values({
        id: generateId(),
        workspaceId,
        email: normalizedEmail,
        label: label || null,
        addedBy: session.user.id,
      })
      .returning()

    return NextResponse.json({ sender })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request', details: error.errors }, { status: 400 })
    }
    logger.error('Failed to add sender', { workspaceId, error })
    return NextResponse.json({ error: 'Failed to add sender' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: workspaceId } = await params
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [hasAccess, permission] = await Promise.all([
    hasInboxAccess(session.user.id),
    getUserEntityPermissions(session.user.id, 'workspace', workspaceId),
  ])
  if (!hasAccess) {
    return NextResponse.json({ error: 'Sim Mailer requires a Max plan' }, { status: 403 })
  }
  if (permission !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  try {
    const { senderId } = deleteSenderSchema.parse(await req.json())

    await db
      .delete(mothershipInboxAllowedSender)
      .where(
        and(
          eq(mothershipInboxAllowedSender.id, senderId),
          eq(mothershipInboxAllowedSender.workspaceId, workspaceId)
        )
      )

    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request', details: error.errors }, { status: 400 })
    }
    logger.error('Failed to delete sender', { workspaceId, error })
    return NextResponse.json({ error: 'Failed to delete sender' }, { status: 500 })
  }
}
