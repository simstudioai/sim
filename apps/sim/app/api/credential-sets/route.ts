import { db } from '@sim/db'
import { credentialSet, credentialSetMember, member, organization, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, count, desc, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'

const logger = createLogger('CredentialSets')

const createCredentialSetSchema = z
  .object({
    organizationId: z.string().min(1),
    name: z.string().trim().min(1).max(100),
    description: z.string().max(500).optional(),
    type: z.enum(['all', 'specific']).default('all'),
    providerId: z.string().min(1).optional(),
  })
  .refine((data) => data.type !== 'specific' || data.providerId, {
    message: 'providerId is required when type is specific',
    path: ['providerId'],
  })

export async function GET(req: Request) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const organizationId = searchParams.get('organizationId')

  if (!organizationId) {
    return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
  }

  const membership = await db
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)))
    .limit(1)

  if (membership.length === 0) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sets = await db
    .select({
      id: credentialSet.id,
      name: credentialSet.name,
      description: credentialSet.description,
      type: credentialSet.type,
      providerId: credentialSet.providerId,
      createdBy: credentialSet.createdBy,
      createdAt: credentialSet.createdAt,
      updatedAt: credentialSet.updatedAt,
      creatorName: user.name,
      creatorEmail: user.email,
    })
    .from(credentialSet)
    .leftJoin(user, eq(credentialSet.createdBy, user.id))
    .where(eq(credentialSet.organizationId, organizationId))
    .orderBy(desc(credentialSet.createdAt))

  const setsWithCounts = await Promise.all(
    sets.map(async (set) => {
      const [memberCount] = await db
        .select({ count: count() })
        .from(credentialSetMember)
        .where(
          and(
            eq(credentialSetMember.credentialSetId, set.id),
            eq(credentialSetMember.status, 'active')
          )
        )

      return {
        ...set,
        memberCount: memberCount?.count ?? 0,
      }
    })
  )

  return NextResponse.json({ credentialSets: setsWithCounts })
}

export async function POST(req: Request) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { organizationId, name, description, type, providerId } =
      createCredentialSetSchema.parse(body)

    const membership = await db
      .select({ id: member.id, role: member.role })
      .from(member)
      .where(and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)))
      .limit(1)

    if (membership.length === 0 || membership[0].role !== 'admin') {
      return NextResponse.json(
        { error: 'Admin permissions required to create credential sets' },
        { status: 403 }
      )
    }

    const orgExists = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (orgExists.length === 0) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    const existingSet = await db
      .select({ id: credentialSet.id })
      .from(credentialSet)
      .where(and(eq(credentialSet.organizationId, organizationId), eq(credentialSet.name, name)))
      .limit(1)

    if (existingSet.length > 0) {
      return NextResponse.json(
        { error: 'A credential set with this name already exists' },
        { status: 409 }
      )
    }

    const now = new Date()
    const newCredentialSet = {
      id: crypto.randomUUID(),
      organizationId,
      name,
      description: description || null,
      type,
      providerId: type === 'specific' ? providerId : null,
      createdBy: session.user.id,
      createdAt: now,
      updatedAt: now,
    }

    await db.insert(credentialSet).values(newCredentialSet)

    logger.info('Created credential set', {
      credentialSetId: newCredentialSet.id,
      organizationId,
      userId: session.user.id,
    })

    return NextResponse.json({ credentialSet: newCredentialSet }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    logger.error('Error creating credential set', error)
    return NextResponse.json({ error: 'Failed to create credential set' }, { status: 500 })
  }
}
