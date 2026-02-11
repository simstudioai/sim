import { db } from '@sim/db'
import { account, credential, credentialMember, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { getWorkspaceMemberUserIds } from '@/lib/credentials/environment'
import { syncWorkspaceOAuthCredentialsForUser } from '@/lib/credentials/oauth'
import { getServiceConfigByProviderId } from '@/lib/oauth'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'
import { isValidEnvVarName } from '@/executor/constants'

const logger = createLogger('CredentialsAPI')

const credentialTypeSchema = z.enum(['oauth', 'env_workspace', 'env_personal'])

function normalizeEnvKeyInput(raw: string): string {
  const trimmed = raw.trim()
  const wrappedMatch = /^\{\{\s*([A-Za-z0-9_]+)\s*\}\}$/.exec(trimmed)
  return wrappedMatch ? wrappedMatch[1] : trimmed
}

const listCredentialsSchema = z.object({
  workspaceId: z.string().uuid('Workspace ID must be a valid UUID'),
  type: credentialTypeSchema.optional(),
  providerId: z.string().optional(),
})

const createCredentialSchema = z
  .object({
    workspaceId: z.string().uuid('Workspace ID must be a valid UUID'),
    type: credentialTypeSchema,
    displayName: z.string().trim().min(1).max(255).optional(),
    providerId: z.string().trim().min(1).optional(),
    accountId: z.string().trim().min(1).optional(),
    envKey: z.string().trim().min(1).optional(),
    envOwnerUserId: z.string().trim().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'oauth') {
      if (!data.accountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'accountId is required for oauth credentials',
          path: ['accountId'],
        })
      }
      if (!data.providerId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'providerId is required for oauth credentials',
          path: ['providerId'],
        })
      }
      if (!data.displayName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'displayName is required for oauth credentials',
          path: ['displayName'],
        })
      }
      return
    }

    const normalizedEnvKey = data.envKey ? normalizeEnvKeyInput(data.envKey) : ''
    if (!normalizedEnvKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'envKey is required for env credentials',
        path: ['envKey'],
      })
      return
    }

    if (!isValidEnvVarName(normalizedEnvKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'envKey must contain only letters, numbers, and underscores',
        path: ['envKey'],
      })
    }
  })

interface ExistingCredentialSourceParams {
  workspaceId: string
  type: 'oauth' | 'env_workspace' | 'env_personal'
  accountId?: string | null
  envKey?: string | null
  envOwnerUserId?: string | null
}

async function findExistingCredentialBySource(params: ExistingCredentialSourceParams) {
  const { workspaceId, type, accountId, envKey, envOwnerUserId } = params

  if (type === 'oauth' && accountId) {
    const [row] = await db
      .select()
      .from(credential)
      .where(
        and(
          eq(credential.workspaceId, workspaceId),
          eq(credential.type, 'oauth'),
          eq(credential.accountId, accountId)
        )
      )
      .limit(1)
    return row ?? null
  }

  if (type === 'env_workspace' && envKey) {
    const [row] = await db
      .select()
      .from(credential)
      .where(
        and(
          eq(credential.workspaceId, workspaceId),
          eq(credential.type, 'env_workspace'),
          eq(credential.envKey, envKey)
        )
      )
      .limit(1)
    return row ?? null
  }

  if (type === 'env_personal' && envKey && envOwnerUserId) {
    const [row] = await db
      .select()
      .from(credential)
      .where(
        and(
          eq(credential.workspaceId, workspaceId),
          eq(credential.type, 'env_personal'),
          eq(credential.envKey, envKey),
          eq(credential.envOwnerUserId, envOwnerUserId)
        )
      )
      .limit(1)
    return row ?? null
  }

  return null
}

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const rawWorkspaceId = searchParams.get('workspaceId')
    const rawType = searchParams.get('type')
    const rawProviderId = searchParams.get('providerId')
    const parseResult = listCredentialsSchema.safeParse({
      workspaceId: rawWorkspaceId?.trim(),
      type: rawType?.trim() || undefined,
      providerId: rawProviderId?.trim() || undefined,
    })

    if (!parseResult.success) {
      logger.warn(`[${requestId}] Invalid credential list request`, {
        workspaceId: rawWorkspaceId,
        type: rawType,
        providerId: rawProviderId,
        errors: parseResult.error.errors,
      })
      return NextResponse.json({ error: parseResult.error.errors[0]?.message }, { status: 400 })
    }

    const { workspaceId, type, providerId } = parseResult.data
    const workspaceAccess = await checkWorkspaceAccess(workspaceId, session.user.id)

    if (!workspaceAccess.hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!type || type === 'oauth') {
      await syncWorkspaceOAuthCredentialsForUser({ workspaceId, userId: session.user.id })
    }

    const whereClauses = [
      eq(credential.workspaceId, workspaceId),
      eq(credentialMember.userId, session.user.id),
      eq(credentialMember.status, 'active'),
    ]

    if (type) {
      whereClauses.push(eq(credential.type, type))
    }
    if (providerId) {
      whereClauses.push(eq(credential.providerId, providerId))
    }

    const credentials = await db
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
      })
      .from(credential)
      .innerJoin(
        credentialMember,
        and(
          eq(credentialMember.credentialId, credential.id),
          eq(credentialMember.userId, session.user.id),
          eq(credentialMember.status, 'active')
        )
      )
      .where(and(...whereClauses))

    return NextResponse.json({ credentials })
  } catch (error) {
    logger.error(`[${requestId}] Failed to list credentials`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const parseResult = createCredentialSchema.safeParse(body)

    if (!parseResult.success) {
      return NextResponse.json({ error: parseResult.error.errors[0]?.message }, { status: 400 })
    }

    const { workspaceId, type, displayName, providerId, accountId, envKey, envOwnerUserId } =
      parseResult.data

    const workspaceAccess = await checkWorkspaceAccess(workspaceId, session.user.id)
    if (!workspaceAccess.canWrite) {
      return NextResponse.json({ error: 'Write permission required' }, { status: 403 })
    }

    let resolvedDisplayName = displayName?.trim() ?? ''
    let resolvedProviderId: string | null = providerId ?? null
    let resolvedAccountId: string | null = accountId ?? null
    const resolvedEnvKey: string | null = envKey ? normalizeEnvKeyInput(envKey) : null
    let resolvedEnvOwnerUserId: string | null = null

    if (type === 'oauth') {
      const [accountRow] = await db
        .select({
          id: account.id,
          userId: account.userId,
          providerId: account.providerId,
          accountId: account.accountId,
        })
        .from(account)
        .where(eq(account.id, accountId!))
        .limit(1)

      if (!accountRow) {
        return NextResponse.json({ error: 'OAuth account not found' }, { status: 404 })
      }

      if (accountRow.userId !== session.user.id) {
        return NextResponse.json(
          { error: 'Only account owners can create oauth credentials for an account' },
          { status: 403 }
        )
      }

      if (providerId !== accountRow.providerId) {
        return NextResponse.json(
          { error: 'providerId does not match the selected OAuth account' },
          { status: 400 }
        )
      }
      if (!resolvedDisplayName) {
        resolvedDisplayName =
          getServiceConfigByProviderId(accountRow.providerId)?.name || accountRow.providerId
      }
    } else if (type === 'env_personal') {
      resolvedEnvOwnerUserId = envOwnerUserId ?? session.user.id
      if (resolvedEnvOwnerUserId !== session.user.id) {
        return NextResponse.json(
          { error: 'Only the current user can create personal env credentials for themselves' },
          { status: 403 }
        )
      }
      resolvedProviderId = null
      resolvedAccountId = null
      resolvedDisplayName = resolvedEnvKey || ''
    } else {
      resolvedProviderId = null
      resolvedAccountId = null
      resolvedEnvOwnerUserId = null
      resolvedDisplayName = resolvedEnvKey || ''
    }

    if (!resolvedDisplayName) {
      return NextResponse.json({ error: 'Display name is required' }, { status: 400 })
    }

    const existingCredential = await findExistingCredentialBySource({
      workspaceId,
      type,
      accountId: resolvedAccountId,
      envKey: resolvedEnvKey,
      envOwnerUserId: resolvedEnvOwnerUserId,
    })

    if (existingCredential) {
      const [membership] = await db
        .select({
          id: credentialMember.id,
          status: credentialMember.status,
          role: credentialMember.role,
        })
        .from(credentialMember)
        .where(
          and(
            eq(credentialMember.credentialId, existingCredential.id),
            eq(credentialMember.userId, session.user.id)
          )
        )
        .limit(1)

      if (!membership || membership.status !== 'active') {
        return NextResponse.json(
          { error: 'A credential with this source already exists in this workspace' },
          { status: 409 }
        )
      }

      if (
        type === 'oauth' &&
        membership.role === 'admin' &&
        resolvedDisplayName &&
        resolvedDisplayName !== existingCredential.displayName
      ) {
        await db
          .update(credential)
          .set({
            displayName: resolvedDisplayName,
            updatedAt: new Date(),
          })
          .where(eq(credential.id, existingCredential.id))

        const [updatedCredential] = await db
          .select()
          .from(credential)
          .where(eq(credential.id, existingCredential.id))
          .limit(1)

        return NextResponse.json(
          { credential: updatedCredential ?? existingCredential },
          { status: 200 }
        )
      }

      return NextResponse.json({ credential: existingCredential }, { status: 200 })
    }

    const now = new Date()
    const credentialId = crypto.randomUUID()
    const [workspaceRow] = await db
      .select({ ownerId: workspace.ownerId })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)

    await db.transaction(async (tx) => {
      await tx.insert(credential).values({
        id: credentialId,
        workspaceId,
        type,
        displayName: resolvedDisplayName,
        providerId: resolvedProviderId,
        accountId: resolvedAccountId,
        envKey: resolvedEnvKey,
        envOwnerUserId: resolvedEnvOwnerUserId,
        createdBy: session.user.id,
        createdAt: now,
        updatedAt: now,
      })

      if (type === 'env_workspace' && workspaceRow?.ownerId) {
        const workspaceUserIds = await getWorkspaceMemberUserIds(workspaceId)
        if (workspaceUserIds.length > 0) {
          for (const memberUserId of workspaceUserIds) {
            await tx.insert(credentialMember).values({
              id: crypto.randomUUID(),
              credentialId,
              userId: memberUserId,
              role: memberUserId === workspaceRow.ownerId ? 'admin' : 'member',
              status: 'active',
              joinedAt: now,
              invitedBy: session.user.id,
              createdAt: now,
              updatedAt: now,
            })
          }
        }
      } else {
        await tx.insert(credentialMember).values({
          id: crypto.randomUUID(),
          credentialId,
          userId: session.user.id,
          role: 'admin',
          status: 'active',
          joinedAt: now,
          invitedBy: session.user.id,
          createdAt: now,
          updatedAt: now,
        })
      }
    })

    const [created] = await db
      .select()
      .from(credential)
      .where(eq(credential.id, credentialId))
      .limit(1)

    return NextResponse.json({ credential: created }, { status: 201 })
  } catch (error: any) {
    if (error?.code === '23505') {
      return NextResponse.json(
        { error: 'A credential with this source already exists' },
        { status: 409 }
      )
    }
    if (error?.code === '23503') {
      return NextResponse.json(
        { error: 'Invalid credential reference or membership target' },
        { status: 400 }
      )
    }
    if (error?.code === '23514') {
      return NextResponse.json(
        { error: 'Credential source data failed validation checks' },
        { status: 400 }
      )
    }
    logger.error(`[${requestId}] Credential create failure details`, {
      code: error?.code,
      detail: error?.detail,
      constraint: error?.constraint,
      table: error?.table,
      message: error?.message,
    })
    logger.error(`[${requestId}] Failed to create credential`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
