import { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, sql } from 'drizzle-orm'
import {
  handleCreateCredentialFromDraft,
  handleReconnectCredential,
} from '@/lib/credentials/draft-hooks'

const logger = createLogger('CredentialDraftProcessor')

interface ProcessCredentialDraftParams {
  draftId?: string
  userId: string
  providerId: string
  accountId: string
}

/**
 * Looks up a pending credential draft and processes it.
 * Draft-backed OAuth launches pass the exact id. Legacy callers without one are
 * accepted only when the user/provider pair has a single active draft.
 * Creates a new credential or reconnects an existing one depending on the draft state.
 * Used by Better Auth's `account.create.after` hook and custom OAuth flows (Shopify, Trello).
 */
export async function processCredentialDraft(params: ProcessCredentialDraftParams): Promise<void> {
  const { draftId, userId, providerId, accountId } = params

  const predicates = [
    eq(schema.pendingCredentialDraft.userId, userId),
    eq(schema.pendingCredentialDraft.providerId, providerId),
    sql`${schema.pendingCredentialDraft.expiresAt} > NOW()`,
  ]
  if (draftId) {
    predicates.push(eq(schema.pendingCredentialDraft.id, draftId))
  }

  const drafts = await db
    .select()
    .from(schema.pendingCredentialDraft)
    .where(and(...predicates))
    .orderBy(desc(schema.pendingCredentialDraft.createdAt))
    .limit(draftId ? 1 : 2)

  if (!draftId && drafts.length > 1) {
    throw new Error(
      `Cannot process an ambiguous OAuth credential draft for user ${userId} and provider ${providerId}`
    )
  }

  const [draft] = drafts

  if (!draft) {
    if (draftId) {
      throw new Error(
        `Cannot process missing or expired OAuth credential draft ${draftId} for user ${userId}`
      )
    }
    return
  }

  const now = new Date()

  if (draft.credentialId) {
    await handleReconnectCredential({
      draft,
      newAccountId: accountId,
      workspaceId: draft.workspaceId,
      userId,
      now,
    })
  } else {
    await handleCreateCredentialFromDraft({
      draft,
      accountId,
      providerId,
      userId,
      now,
    })
  }

  await db
    .delete(schema.pendingCredentialDraft)
    .where(eq(schema.pendingCredentialDraft.id, draft.id))

  logger.info('Processed credential draft', {
    draftId: draft.id,
    userId,
    providerId,
    isReconnect: Boolean(draft.credentialId),
  })
}
