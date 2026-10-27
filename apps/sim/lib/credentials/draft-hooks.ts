import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresConstraintName, getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { deleteOrphanedOAuthAccount } from '@/lib/credentials/deletion'
import { resumeConnectorsAfterCredentialReconnect } from '@/lib/knowledge/connectors/credential-recovery'
import { clearOAuthRefreshFailure } from '@/lib/oauth/credential-service'
import { captureServerEvent } from '@/lib/posthog/server'

const logger = createLogger('CredentialDraftHooks')

/**
 * A reconnect chose an account that already backs another credential in the
 * same workspace. Two credentials in one workspace never share an account, so
 * the reconnect is refused and the credential keeps the account it had.
 */
export class CredentialAccountConflictError extends Error {
  constructor(
    readonly credentialId: string,
    readonly conflictingCredentialId: string
  ) {
    super(
      `Cannot reconnect credential ${credentialId}: its new account is already used by credential ${conflictingCredentialId}`
    )
    this.name = 'CredentialAccountConflictError'
  }
}

/**
 * Finds a credential other than `credentialId` in the workspace that uses one
 * of `accountIds`, the credential a reconnect onto those accounts would collide with.
 */
export async function findConflictingWorkspaceCredential(params: {
  credentialId: string
  workspaceId: string
  accountIds: string[]
}): Promise<{ id: string; displayName: string } | null> {
  if (params.accountIds.length === 0) return null
  const [conflicting] = await db
    .select({ id: schema.credential.id, displayName: schema.credential.displayName })
    .from(schema.credential)
    .where(
      and(
        eq(schema.credential.workspaceId, params.workspaceId),
        inArray(schema.credential.accountId, params.accountIds),
        ne(schema.credential.id, params.credentialId)
      )
    )
    .limit(1)
  return conflicting ?? null
}

/**
 * Creates a new credential from a pending draft (normal OAuth connect flow).
 */
export async function handleCreateCredentialFromDraft(params: {
  draft: { workspaceId: string; displayName: string; description: string | null }
  accountId: string
  providerId: string
  userId: string
  now: Date
}) {
  const { draft, accountId, providerId, userId, now } = params
  const credentialId = generateId()

  try {
    await db.insert(schema.credential).values({
      id: credentialId,
      workspaceId: draft.workspaceId,
      type: 'oauth',
      displayName: draft.displayName,
      description: draft.description ?? null,
      providerId,
      accountId,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })
  } catch (insertError: unknown) {
    if (
      getPostgresErrorCode(insertError) !== '23505' ||
      getPostgresConstraintName(insertError) !== 'credential_workspace_account_unique'
    ) {
      throw insertError
    }

    const [existingCredential] = await db
      .select({ id: schema.credential.id, displayName: schema.credential.displayName })
      .from(schema.credential)
      .where(
        and(
          eq(schema.credential.workspaceId, draft.workspaceId),
          eq(schema.credential.accountId, accountId)
        )
      )
      .limit(1)

    if (!existingCredential) {
      throw new Error(
        `Credential account conflict was reported without an existing credential for account ${accountId}`
      )
    }

    logger.info('OAuth account is already connected to this workspace', {
      credentialId: existingCredential.id,
      displayName: existingCredential.displayName,
      providerId,
      accountId,
    })

    await db
      .update(schema.credential)
      .set({ updatedAt: now })
      .where(eq(schema.credential.id, existingCredential.id))

    await clearOAuthRefreshFailure(accountId)
    await resumeConnectorsAfterCredentialReconnect(accountId, now)

    recordAudit({
      workspaceId: draft.workspaceId,
      actorId: userId,
      action: AuditAction.CREDENTIAL_RECONNECTED,
      resourceType: AuditResourceType.CREDENTIAL,
      resourceId: existingCredential.id,
      resourceName: existingCredential.displayName,
      description: `Reconnected OAuth credential "${existingCredential.displayName}"`,
      metadata: { accountId },
    })
    return
  }

  await db.insert(schema.credentialMember).values({
    id: generateId(),
    credentialId,
    userId,
    role: 'admin',
    status: 'active',
    joinedAt: now,
    invitedBy: userId,
    createdAt: now,
    updatedAt: now,
  })

  logger.info('Created credential from draft', {
    credentialId,
    displayName: draft.displayName,
    providerId,
    accountId,
  })

  await clearOAuthRefreshFailure(accountId)

  recordAudit({
    workspaceId: draft.workspaceId,
    actorId: userId,
    action: AuditAction.CREDENTIAL_CREATED,
    resourceType: AuditResourceType.CREDENTIAL,
    resourceId: credentialId,
    resourceName: draft.displayName,
    description: `Created OAuth credential "${draft.displayName}"`,
    metadata: { providerId, accountId },
  })

  captureServerEvent(
    userId,
    'credential_connected',
    {
      credential_type: 'oauth',
      provider_id: providerId,
      workspace_id: draft.workspaceId,
    },
    {
      groups: { workspace: draft.workspaceId },
      setOnce: { first_credential_connected_at: now.toISOString() },
    }
  )
}

/**
 * Reconnects an existing credential to the account the user just authorized.
 * Handles unique constraint checks and orphaned account cleanup.
 *
 * Re-authorizing the *same* account is the common case — a dead or expired
 * token the user refreshes in place — so it still bumps `updatedAt` and clears
 * the dead flag. Callers treat that timestamp as proof the reconnect landed.
 */
export async function handleReconnectCredential(params: {
  draft: { credentialId: string | null }
  newAccountId: string
  workspaceId: string
  userId: string
  now: Date
}) {
  const { draft, newAccountId, workspaceId, userId, now } = params
  if (!draft.credentialId) return

  const [existingCredential] = await db
    .select({
      id: schema.credential.id,
      accountId: schema.credential.accountId,
      displayName: schema.credential.displayName,
    })
    .from(schema.credential)
    .where(eq(schema.credential.id, draft.credentialId))
    .limit(1)

  if (!existingCredential) {
    throw new Error(`Cannot reconnect missing credential ${draft.credentialId}`)
  }

  const oldAccountId = existingCredential.accountId
  const displayName = existingCredential.displayName
  const accountChanged = oldAccountId !== newAccountId

  if (accountChanged) {
    const conflicting = await findConflictingWorkspaceCredential({
      credentialId: draft.credentialId,
      workspaceId,
      accountIds: [newAccountId],
    })
    if (conflicting) {
      throw new CredentialAccountConflictError(draft.credentialId, conflicting.id)
    }
  }

  await db
    .update(schema.credential)
    .set({ accountId: newAccountId, updatedAt: now })
    .where(eq(schema.credential.id, draft.credentialId))

  logger.info(
    accountChanged
      ? 'Reconnected credential to new account'
      : 'Reconnected credential to the same account',
    {
      credentialId: draft.credentialId,
      oldAccountId,
      newAccountId,
    }
  )

  await clearOAuthRefreshFailure(newAccountId)
  await resumeConnectorsAfterCredentialReconnect(newAccountId, now)

  recordAudit({
    workspaceId,
    actorId: userId,
    action: AuditAction.CREDENTIAL_RECONNECTED,
    resourceType: AuditResourceType.CREDENTIAL,
    resourceId: draft.credentialId,
    resourceName: displayName,
    description: accountChanged
      ? `Reconnected OAuth credential "${displayName}" to a new account`
      : `Reconnected OAuth credential "${displayName}"`,
    metadata: { oldAccountId, newAccountId },
  })

  if (oldAccountId) {
    await deleteOrphanedOAuthAccount(oldAccountId)
  }
}
