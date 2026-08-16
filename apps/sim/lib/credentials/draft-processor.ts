import { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, sql } from 'drizzle-orm'
import { OAUTH_CREDENTIAL_DRAFT_CALLBACK_PARAM } from '@/lib/credentials/draft-constants'
import {
  handleCreateCredentialFromDraft,
  handleReconnectCredential,
} from '@/lib/credentials/draft-hooks'

const logger = createLogger('CredentialDraftProcessor')

interface OAuthStateWithCallbackUrl {
  callbackURL?: unknown
}

export type OAuthCredentialDraftBinding =
  | { status: 'available'; draftId?: string }
  | { status: 'unavailable'; error: unknown }

type AvailableOAuthCredentialDraftBinding = Extract<
  OAuthCredentialDraftBinding,
  { status: 'available' }
>

const oauthCredentialDraftBindings = new WeakMap<object, AvailableOAuthCredentialDraftBinding>()

/** Extracts a draft binding from Better Auth state and rejects malformed callback state. */
export function parseCredentialDraftIdFromCallbackUrl(callbackUrl: unknown): string | undefined {
  if (callbackUrl === undefined) return undefined
  if (typeof callbackUrl !== 'string') {
    throw new Error('OAuth state callback URL must be a string')
  }
  return new URL(callbackUrl).searchParams.get(OAUTH_CREDENTIAL_DRAFT_CALLBACK_PARAM) ?? undefined
}

/** Reads an exact draft binding without falling back when OAuth state is unavailable. */
export async function loadOAuthCredentialDraftBinding(
  loadOAuthState: () => Promise<OAuthStateWithCallbackUrl | null | undefined>
): Promise<OAuthCredentialDraftBinding> {
  try {
    const oauthState = await loadOAuthState()
    return {
      status: 'available',
      draftId: parseCredentialDraftIdFromCallbackUrl(oauthState?.callbackURL),
    }
  } catch (error) {
    return { status: 'unavailable', error }
  }
}

/** Captures request-scoped OAuth state before Better Auth defers its account after-hook. */
export async function captureOAuthCredentialDraftBinding(
  context: object,
  loadOAuthState: () => Promise<OAuthStateWithCallbackUrl | null | undefined>
): Promise<void> {
  const binding = await loadOAuthCredentialDraftBinding(loadOAuthState)
  if (binding.status === 'unavailable') throw binding.error
  oauthCredentialDraftBindings.set(context, binding)
}

/** Consumes the binding captured for the same Better Auth account-hook context. */
export function consumeOAuthCredentialDraftBinding(
  context: object
): AvailableOAuthCredentialDraftBinding | undefined {
  const binding = oauthCredentialDraftBindings.get(context)
  oauthCredentialDraftBindings.delete(context)
  return binding
}

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
