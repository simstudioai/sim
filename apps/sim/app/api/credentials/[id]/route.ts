import { db } from '@sim/db'
import { credential, credentialMember } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { getCredentialActorContext } from '@/lib/credentials/access'

const logger = createLogger('CredentialByIdAPI')

const updateCredentialSchema = z
  .object({
    displayName: z.string().trim().min(1).max(255).optional(),
    accountId: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine((data) => Boolean(data.displayName || data.accountId), {
    message: 'At least one field must be provided',
    path: ['displayName'],
  })

async function getCredentialResponse(credentialId: string, userId: string) {
  const [row] = await db
    .select({
      id: credential.id,
      workspaceId: credential.workspaceId,
      type: credential.type,
      displayName: credential.displayName,
      providerId: credential.providerId,
      accountId: credential.accountId,
      envKey: credential.envKey,
      envOwnerUserId: credential.envOwnerUserId,
      createdBy: credential.createdBy,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
      role: credentialMember.role,
      status: credentialMember.status,
    })
    .from(credential)
    .innerJoin(
      credentialMember,
      and(eq(credentialMember.credentialId, credential.id), eq(credentialMember.userId, userId))
    )
    .where(eq(credential.id, credentialId))
    .limit(1)

  return row ?? null
}

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
    if (!access.hasWorkspaceAccess || !access.member) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const row = await getCredentialResponse(id, session.user.id)
    return NextResponse.json({ credential: row }, { status: 200 })
  } catch (error) {
    logger.error('Failed to fetch credential', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    const parseResult = updateCredentialSchema.safeParse(await request.json())
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

    if (access.credential.type === 'oauth') {
      return NextResponse.json(
        {
          error:
            'OAuth credential editing is disabled. Connect an account and create or use its linked credential.',
        },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        error:
          'Environment credentials cannot be updated via this endpoint. Use the environment value editor in credentials settings.',
      },
      { status: 400 }
    )
  } catch (error) {
    logger.error('Failed to update credential', error)
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
    const access = await getCredentialActorContext(id, session.user.id)
    if (!access.credential) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }
    if (!access.hasWorkspaceAccess || !access.isAdmin) {
      return NextResponse.json({ error: 'Credential admin permission required' }, { status: 403 })
    }

    await db.delete(credential).where(eq(credential.id, id))
    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    logger.error('Failed to delete credential', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
