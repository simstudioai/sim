import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresConstraintName, getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, sql } from 'drizzle-orm'
import { deleteOrphanedOAuthAccount } from '@/lib/credentials/deletion'
import { clearDeadFlag } from '@/lib/oauth/terminal-errors'
import { captureServerEvent } from '@/lib/posthog/server'

const logger = createLogger('CredentialDraftHooks')

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

    await clearDeadFlag(accountId)

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

  await clearDeadFlag(accountId)

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
    const [conflicting] = await db
      .select({ id: schema.credential.id })
      .from(schema.credential)
      .where(
        and(
          eq(schema.credential.workspaceId, workspaceId),
          eq(schema.credential.accountId, newAccountId),
          sql`${schema.credential.id} != ${draft.credentialId}`
        )
      )
      .limit(1)

    if (conflicting) {
      throw new Error(
        `Cannot reconnect credential ${draft.credentialId}: account ${newAccountId} is already used by credential ${conflicting.id}`
      )
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

  await clearDeadFlag(newAccountId)

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
