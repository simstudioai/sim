import { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, sql } from 'drizzle-orm'

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
  const credentialId = crypto.randomUUID()

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

    await db.insert(schema.credentialMember).values({
      id: crypto.randomUUID(),
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
  } catch (insertError: unknown) {
    const code =
      insertError && typeof insertError === 'object' && 'code' in insertError
        ? (insertError as { code: string }).code
        : undefined
    if (code !== '23505') {
      throw insertError
    }
    logger.info('Credential already exists, skipping draft', {
      providerId,
      accountId,
    })
  }
}

/**
 * Reconnects an existing credential to a new OAuth account.
 * Handles unique constraint checks and orphaned account cleanup.
 */
export async function handleReconnectCredential(params: {
  draft: { credentialId: string | null; workspaceId: string; displayName: string }
  newAccountId: string
  workspaceId: string
  now: Date
}) {
  const { draft, newAccountId, workspaceId, now } = params
  if (!draft.credentialId) return

  const [existingCredential] = await db
    .select({ id: schema.credential.id, accountId: schema.credential.accountId })
    .from(schema.credential)
    .where(eq(schema.credential.id, draft.credentialId))
    .limit(1)

  if (!existingCredential) {
    logger.warn('Credential not found for reconnect, skipping', {
      credentialId: draft.credentialId,
    })
    return
  }

  const oldAccountId = existingCredential.accountId

  if (oldAccountId === newAccountId) {
    logger.info('Account unchanged during reconnect, skipping update', {
      credentialId: draft.credentialId,
      accountId: newAccountId,
    })
    return
  }

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
    logger.warn('New account already used by another credential, skipping reconnect', {
      credentialId: draft.credentialId,
      newAccountId,
      conflictingCredentialId: conflicting.id,
    })
    return
  }

  await db
    .update(schema.credential)
    .set({ accountId: newAccountId, updatedAt: now })
    .where(eq(schema.credential.id, draft.credentialId))

  logger.info('Reconnected credential to new account', {
    credentialId: draft.credentialId,
    oldAccountId,
    newAccountId,
  })

  if (oldAccountId) {
    const [stillReferenced] = await db
      .select({ id: schema.credential.id })
      .from(schema.credential)
      .where(eq(schema.credential.accountId, oldAccountId))
      .limit(1)

    if (!stillReferenced) {
      await db.delete(schema.account).where(eq(schema.account.id, oldAccountId))
      logger.info('Deleted orphaned account after reconnect', { accountId: oldAccountId })
    }
  }
}
