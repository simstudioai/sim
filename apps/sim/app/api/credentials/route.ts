import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { account, credential, credentialMember, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  createWorkspaceCredentialContract,
  credentialsListGetQuerySchema,
  normalizeCredentialEnvKey,
  serviceAccountJsonSchema,
} from '@/lib/api/contracts/credentials'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { encryptSecret } from '@/lib/core/security/encryption'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  AtlassianValidationError,
  normalizeAtlassianDomain,
  validateAtlassianServiceAccount,
} from '@/lib/credentials/atlassian-service-account'
import { getWorkspaceMemberUserIds } from '@/lib/credentials/environment'
import { syncWorkspaceOAuthCredentialsForUser } from '@/lib/credentials/oauth'
import { getServiceConfigByProviderId } from '@/lib/oauth'
import {
  ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
  ATLASSIAN_SERVICE_ACCOUNT_SECRET_TYPE,
} from '@/lib/oauth/types'
import { captureServerEvent } from '@/lib/posthog/server'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CredentialsAPI')

/**
 * Thrown by the inner duplicate guard inside the create transaction when a
 * concurrent request slipped a row in between the outer existence check and
 * our INSERT. The catch maps this to a 409 with a typed `code` so the UI can
 * map to a friendly message.
 */
class DuplicateCredentialError extends Error {
  constructor() {
    super('duplicate_display_name')
    this.name = 'DuplicateCredentialError'
  }
}

interface ExistingCredentialSourceParams {
  workspaceId: string
  type: 'oauth' | 'env_workspace' | 'env_personal' | 'service_account'
  accountId?: string | null
  envKey?: string | null
  envOwnerUserId?: string | null
  displayName?: string | null
  providerId?: string | null
}

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

async function findExistingCredentialBySourceWith(
  exec: DbOrTx,
  params: ExistingCredentialSourceParams
) {
  const { workspaceId, type, accountId, envKey, envOwnerUserId, displayName, providerId } = params

  if (type === 'oauth' && accountId) {
    const [row] = await exec
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
    const [row] = await exec
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
    const [row] = await exec
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

  if (type === 'service_account' && displayName && providerId) {
    const [row] = await exec
      .select()
      .from(credential)
      .where(
        and(
          eq(credential.workspaceId, workspaceId),
          eq(credential.type, 'service_account'),
          eq(credential.providerId, providerId),
          eq(credential.displayName, displayName)
        )
      )
      .limit(1)
    return row ?? null
  }

  return null
}

async function findExistingCredentialBySource(params: ExistingCredentialSourceParams) {
  return findExistingCredentialBySourceWith(db, params)
}

async function findExistingCredentialBySourceTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  params: ExistingCredentialSourceParams
) {
  return findExistingCredentialBySourceWith(tx, params)
}

export const GET = withRouteHandler(async (request: NextRequest) => {
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
    const rawCredentialId = searchParams.get('credentialId')
    const parseResult = credentialsListGetQuerySchema.safeParse({
      workspaceId: rawWorkspaceId?.trim(),
      type: rawType?.trim() || undefined,
      providerId: rawProviderId?.trim() || undefined,
      credentialId: rawCredentialId?.trim() || undefined,
    })

    if (!parseResult.success) {
      logger.warn(`[${requestId}] Invalid credential list request`, {
        workspaceId: rawWorkspaceId,
        type: rawType,
        providerId: rawProviderId,
        errors: parseResult.error.issues,
      })
      return NextResponse.json(
        { error: getValidationErrorMessage(parseResult.error) },
        { status: 400 }
      )
    }

    const { workspaceId, type, providerId, credentialId: lookupCredentialId } = parseResult.data
    const workspaceAccess = await checkWorkspaceAccess(workspaceId, session.user.id)

    if (!workspaceAccess.hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (lookupCredentialId) {
      let [row] = await db
        .select({
          id: credential.id,
          displayName: credential.displayName,
          type: credential.type,
          providerId: credential.providerId,
        })
        .from(credential)
        .where(and(eq(credential.id, lookupCredentialId), eq(credential.workspaceId, workspaceId)))
        .limit(1)

      if (!row) {
        ;[row] = await db
          .select({
            id: credential.id,
            displayName: credential.displayName,
            type: credential.type,
            providerId: credential.providerId,
          })
          .from(credential)
          .where(
            and(
              eq(credential.accountId, lookupCredentialId),
              eq(credential.workspaceId, workspaceId)
            )
          )
          .limit(1)
      }

      return NextResponse.json({ credential: row ?? null })
    }

    if (!type || type === 'oauth') {
      await syncWorkspaceOAuthCredentialsForUser({ workspaceId, userId: session.user.id })
    }

    const whereClauses = [eq(credential.workspaceId, workspaceId)]

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
        description: credential.description,
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
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseRequest(
      createWorkspaceCredentialContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          NextResponse.json({ error: getValidationErrorMessage(error) }, { status: 400 }),
      }
    )
    if (!parsed.success) return parsed.response

    const {
      workspaceId,
      type,
      displayName,
      description,
      providerId,
      accountId,
      envKey,
      envOwnerUserId,
      serviceAccountJson,
      apiToken,
      domain,
    } = parsed.data.body

    const workspaceAccess = await checkWorkspaceAccess(workspaceId, session.user.id)
    if (!workspaceAccess.canWrite) {
      return NextResponse.json({ error: 'Write permission required' }, { status: 403 })
    }

    let resolvedDisplayName = displayName?.trim() ?? ''
    const resolvedDescription = description?.trim() || null
    let resolvedProviderId: string | null = providerId ?? null
    let resolvedAccountId: string | null = accountId ?? null
    const resolvedEnvKey: string | null = envKey ? normalizeCredentialEnvKey(envKey) : null
    let resolvedEnvOwnerUserId: string | null = null
    let resolvedEncryptedServiceAccountKey: string | null = null
    const extraAuditMetadata: Record<string, unknown> = {}

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
    } else if (type === 'service_account') {
      if (providerId === ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID) {
        if (!apiToken || !domain) {
          return NextResponse.json(
            { error: 'apiToken and domain are required for Atlassian service account credentials' },
            { status: 400 }
          )
        }

        const normalizedDomain = normalizeAtlassianDomain(domain)
        const validation = await validateAtlassianServiceAccount(apiToken, normalizedDomain)

        resolvedProviderId = ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID
        resolvedAccountId = null
        resolvedEnvOwnerUserId = null

        if (!resolvedDisplayName) {
          resolvedDisplayName = validation.displayName
        }

        const blob = JSON.stringify({
          type: ATLASSIAN_SERVICE_ACCOUNT_SECRET_TYPE,
          apiToken,
          domain: normalizedDomain,
          cloudId: validation.cloudId,
          atlassianAccountId: validation.accountId,
        })
        const { encrypted } = await encryptSecret(blob)
        resolvedEncryptedServiceAccountKey = encrypted
        extraAuditMetadata.atlassianDomain = normalizedDomain
        extraAuditMetadata.atlassianCloudId = validation.cloudId
      } else {
        if (!serviceAccountJson) {
          return NextResponse.json(
            { error: 'serviceAccountJson is required for service account credentials' },
            { status: 400 }
          )
        }

        const jsonParseResult = serviceAccountJsonSchema.safeParse(serviceAccountJson)
        if (!jsonParseResult.success) {
          return NextResponse.json(
            {
              error: getValidationErrorMessage(
                jsonParseResult.error,
                'Invalid service account JSON'
              ),
            },
            { status: 400 }
          )
        }

        const parsedKey = jsonParseResult.data
        resolvedProviderId = 'google-service-account'
        resolvedAccountId = null
        resolvedEnvOwnerUserId = null

        if (!resolvedDisplayName) {
          resolvedDisplayName = parsedKey.client_email
        }

        const { encrypted } = await encryptSecret(serviceAccountJson)
        resolvedEncryptedServiceAccountKey = encrypted
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
      displayName: resolvedDisplayName,
      providerId: resolvedProviderId,
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

      const canUpdateExistingCredential = membership.role === 'admin'
      const shouldUpdateDisplayName =
        type === 'oauth' &&
        resolvedDisplayName &&
        resolvedDisplayName !== existingCredential.displayName
      const shouldUpdateDescription =
        typeof description !== 'undefined' &&
        (existingCredential.description ?? null) !== resolvedDescription

      if (canUpdateExistingCredential && (shouldUpdateDisplayName || shouldUpdateDescription)) {
        await db
          .update(credential)
          .set({
            ...(shouldUpdateDisplayName ? { displayName: resolvedDisplayName } : {}),
            ...(shouldUpdateDescription ? { description: resolvedDescription } : {}),
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
    const credentialId = generateId()
    const [workspaceRow] = await db
      .select({ ownerId: workspace.ownerId })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)

    await db.transaction(async (tx) => {
      // service_account has no DB-level unique index on (workspaceId, providerId,
      // displayName), so we re-check inside the tx. OAuth/env_* are guarded by
      // partial unique indexes and fall through to the 23505 handler below.
      if (type === 'service_account') {
        const innerExisting = await findExistingCredentialBySourceTx(tx, {
          workspaceId,
          type,
          displayName: resolvedDisplayName,
          providerId: resolvedProviderId,
        })
        if (innerExisting) throw new DuplicateCredentialError()
      }

      await tx.insert(credential).values({
        id: credentialId,
        workspaceId,
        type,
        displayName: resolvedDisplayName,
        description: resolvedDescription,
        providerId: resolvedProviderId,
        accountId: resolvedAccountId,
        envKey: resolvedEnvKey,
        envOwnerUserId: resolvedEnvOwnerUserId,
        encryptedServiceAccountKey: resolvedEncryptedServiceAccountKey,
        createdBy: session.user.id,
        createdAt: now,
        updatedAt: now,
      })

      if ((type === 'env_workspace' || type === 'service_account') && workspaceRow?.ownerId) {
        const workspaceUserIds = await getWorkspaceMemberUserIds(workspaceId)
        if (workspaceUserIds.length > 0) {
          for (const memberUserId of workspaceUserIds) {
            await tx.insert(credentialMember).values({
              id: generateId(),
              credentialId,
              userId: memberUserId,
              role:
                memberUserId === workspaceRow.ownerId || memberUserId === session.user.id
                  ? 'admin'
                  : 'member',
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
          id: generateId(),
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

    captureServerEvent(
      session.user.id,
      'credential_connected',
      { credential_type: type, provider_id: resolvedProviderId ?? type, workspace_id: workspaceId },
      {
        groups: { workspace: workspaceId },
        setOnce: { first_credential_connected_at: new Date().toISOString() },
      }
    )

    recordAudit({
      workspaceId,
      actorId: session.user.id,
      actorName: session.user.name,
      actorEmail: session.user.email,
      action: AuditAction.CREDENTIAL_CREATED,
      resourceType: AuditResourceType.CREDENTIAL,
      resourceId: credentialId,
      resourceName: resolvedDisplayName,
      description: `Created ${type} credential "${resolvedDisplayName}"`,
      metadata: {
        credentialType: type,
        providerId: resolvedProviderId,
        ...extraAuditMetadata,
      },
      request,
    })

    return NextResponse.json({ credential: created }, { status: 201 })
  } catch (error: unknown) {
    if (error instanceof AtlassianValidationError) {
      logger.warn(`[${requestId}] Atlassian credential rejected: ${error.code}`, {
        code: error.code,
        upstreamStatus: error.status,
        ...error.logDetail,
      })
      return NextResponse.json({ code: error.code, error: error.code }, { status: 400 })
    }
    if (error instanceof DuplicateCredentialError) {
      return NextResponse.json(
        {
          code: 'duplicate_display_name',
          error: 'A credential with that name already exists in this workspace.',
        },
        { status: 409 }
      )
    }
    const pgCode = getPostgresErrorCode(error)
    if (pgCode === '23505') {
      return NextResponse.json(
        { error: 'A credential with this source already exists' },
        { status: 409 }
      )
    }
    if (pgCode === '23503') {
      return NextResponse.json(
        { error: 'Invalid credential reference or membership target' },
        { status: 400 }
      )
    }
    if (pgCode === '23514') {
      return NextResponse.json(
        { error: 'Credential source data failed validation checks' },
        { status: 400 }
      )
    }
    const errAsRecord =
      typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {}
    logger.error(`[${requestId}] Credential create failure details`, {
      code: pgCode,
      detail: errAsRecord.detail,
      constraint: errAsRecord.constraint,
      table: errAsRecord.table,
      message: errAsRecord.message,
    })
    logger.error(`[${requestId}] Failed to create credential`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
