import { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, sql } from 'drizzle-orm'
import {
  handleCreateCredentialFromDraft,
  handleReconnectCredential,
} from '@/lib/credentials/draft-hooks'

const logger = createLogger('CredentialDraftProcessor')

interface ProcessCredentialDraftParams {
  userId: string
  providerId: string
  accountId: string
}

/**
 * Looks up a pending credential draft for the given user/provider and processes it.
 * Creates a new credential or reconnects an existing one depending on the draft state.
 * Used by Better Auth's `account.create.after` hook and custom OAuth flows (Shopify, Trello).
 */
export async function processCredentialDraft(params: ProcessCredentialDraftParams): Promise<void> {
  const { userId, providerId, accountId } = params

  const [draft] = await db
    .select()
    .from(schema.pendingCredentialDraft)
    .where(
      and(
        eq(schema.pendingCredentialDraft.userId, userId),
        eq(schema.pendingCredentialDraft.providerId, providerId),
        sql`${schema.pendingCredentialDraft.expiresAt} > NOW()`
      )
    )
    .limit(1)

  if (!draft) return

  const now = new Date()

  if (draft.credentialId) {
    await handleReconnectCredential({
      draft,
      newAccountId: accountId,
      workspaceId: draft.workspaceId,
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
