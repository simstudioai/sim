import { db } from '@sim/db'
import { credential, credentialMember, environment, workspaceEnvironment } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { getCredentialActorContext } from '@/lib/credentials/access'
import {
  syncPersonalEnvCredentialsForUser,
  syncWorkspaceEnvCredentials,
} from '@/lib/credentials/environment'

const logger = createLogger('CredentialByIdAPI')

const updateCredentialSchema = z
  .object({
    displayName: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(500).nullish(),
    accountId: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.displayName !== undefined ||
      data.description !== undefined ||
      data.accountId !== undefined,
    {
      message: 'At least one field must be provided',
      path: ['displayName'],
    }
  )

async function getCredentialResponse(credentialId: string, userId: string) {
  const [row] = await db
    .select({
      id: credential.id,
      workspaceId: credential.workspaceId,
      type: credential.type,
      displayName: credential.displayName,
      description: credential.description,
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

    const updates: Record<string, unknown> = {}

    if (parseResult.data.description !== undefined) {
      updates.description = parseResult.data.description ?? null
    }

    if (parseResult.data.displayName !== undefined && access.credential.type === 'oauth') {
      updates.displayName = parseResult.data.displayName
    }

    if (Object.keys(updates).length === 0) {
      if (access.credential.type === 'oauth') {
        return NextResponse.json(
          {
            error: 'No updatable fields provided.',
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
    }

    updates.updatedAt = new Date()
    await db.update(credential).set(updates).where(eq(credential.id, id))

    const row = await getCredentialResponse(id, session.user.id)
    return NextResponse.json({ credential: row }, { status: 200 })
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

    if (access.credential.type === 'env_personal' && access.credential.envKey) {
      const ownerUserId = access.credential.envOwnerUserId
      if (!ownerUserId) {
        return NextResponse.json({ error: 'Invalid personal secret owner' }, { status: 400 })
      }

      const [personalRow] = await db
        .select({ variables: environment.variables })
        .from(environment)
        .where(eq(environment.userId, ownerUserId))
        .limit(1)

      const current = ((personalRow?.variables as Record<string, string> | null) ?? {}) as Record<
        string,
        string
      >
      if (access.credential.envKey in current) {
        delete current[access.credential.envKey]
      }

      await db
        .insert(environment)
        .values({
          id: ownerUserId,
          userId: ownerUserId,
          variables: current,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [environment.userId],
          set: { variables: current, updatedAt: new Date() },
        })

      await syncPersonalEnvCredentialsForUser({
        userId: ownerUserId,
        envKeys: Object.keys(current),
      })

      return NextResponse.json({ success: true }, { status: 200 })
    }

    if (access.credential.type === 'env_workspace' && access.credential.envKey) {
      const [workspaceRow] = await db
        .select({
          id: workspaceEnvironment.id,
          createdAt: workspaceEnvironment.createdAt,
          variables: workspaceEnvironment.variables,
        })
        .from(workspaceEnvironment)
        .where(eq(workspaceEnvironment.workspaceId, access.credential.workspaceId))
        .limit(1)

      const current = ((workspaceRow?.variables as Record<string, string> | null) ?? {}) as Record<
        string,
        string
      >
      if (access.credential.envKey in current) {
        delete current[access.credential.envKey]
      }

      await db
        .insert(workspaceEnvironment)
        .values({
          id: workspaceRow?.id || crypto.randomUUID(),
          workspaceId: access.credential.workspaceId,
          variables: current,
          createdAt: workspaceRow?.createdAt || new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [workspaceEnvironment.workspaceId],
          set: { variables: current, updatedAt: new Date() },
        })

      await syncWorkspaceEnvCredentials({
        workspaceId: access.credential.workspaceId,
        envKeys: Object.keys(current),
        actingUserId: session.user.id,
      })

      return NextResponse.json({ success: true }, { status: 200 })
    }

    await db.delete(credential).where(eq(credential.id, id))
    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    logger.error('Failed to delete credential', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
