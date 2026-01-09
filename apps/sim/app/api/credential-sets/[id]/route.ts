import { db } from '@sim/db'
import { credentialSet, credentialSetMember, member } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { hasCredentialSetsAccess } from '@/lib/billing'

const logger = createLogger('CredentialSet')

const updateCredentialSetSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
})

async function getCredentialSetWithAccess(credentialSetId: string, userId: string) {
  const [set] = await db
    .select({
      id: credentialSet.id,
      organizationId: credentialSet.organizationId,
      name: credentialSet.name,
      description: credentialSet.description,
      providerId: credentialSet.providerId,
      createdBy: credentialSet.createdBy,
      createdAt: credentialSet.createdAt,
      updatedAt: credentialSet.updatedAt,
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

  return NextResponse.json({ credentialSet: result.set })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  try {
    const result = await getCredentialSetWithAccess(id, session.user.id)

    if (!result) {
      return NextResponse.json({ error: 'Credential set not found' }, { status: 404 })
    }

    if (result.role !== 'admin' && result.role !== 'owner') {
      return NextResponse.json({ error: 'Admin or owner permissions required' }, { status: 403 })
    }

    const body = await req.json()
    const updates = updateCredentialSetSchema.parse(body)

    if (updates.name) {
      const existingSet = await db
        .select({ id: credentialSet.id })
        .from(credentialSet)
        .where(
          and(
            eq(credentialSet.organizationId, result.set.organizationId),
            eq(credentialSet.name, updates.name)
          )
        )
        .limit(1)

      if (existingSet.length > 0 && existingSet[0].id !== id) {
        return NextResponse.json(
          { error: 'A credential set with this name already exists' },
          { status: 409 }
        )
      }
    }

    await db
      .update(credentialSet)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(credentialSet.id, id))

    const [updated] = await db.select().from(credentialSet).where(eq(credentialSet.id, id)).limit(1)

    return NextResponse.json({ credentialSet: updated })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    logger.error('Error updating credential set', error)
    return NextResponse.json({ error: 'Failed to update credential set' }, { status: 500 })
  }
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

  try {
    const result = await getCredentialSetWithAccess(id, session.user.id)

    if (!result) {
      return NextResponse.json({ error: 'Credential set not found' }, { status: 404 })
    }

    if (result.role !== 'admin' && result.role !== 'owner') {
      return NextResponse.json({ error: 'Admin or owner permissions required' }, { status: 403 })
    }

    await db.delete(credentialSetMember).where(eq(credentialSetMember.credentialSetId, id))
    await db.delete(credentialSet).where(eq(credentialSet.id, id))

    logger.info('Deleted credential set', { credentialSetId: id, userId: session.user.id })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting credential set', error)
    return NextResponse.json({ error: 'Failed to delete credential set' }, { status: 500 })
  }
}
