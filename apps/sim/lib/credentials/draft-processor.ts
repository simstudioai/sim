import { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, sql } from 'drizzle-orm'
import { OAUTH_CREDENTIAL_DRAFT_CALLBACK_PARAM } from '@/lib/credentials/draft-constants'
import {
  handleCreateCredentialFromDraft,
  handleReconnectCredential,
} from '@/lib/credentials/draft-hooks'
import { completeOrganizationCredentialDraft } from '@/lib/credentials/organization-draft'

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

/**
 * Base a path-absolute callback URL is resolved against. Only the query string
 * is ever read, so the origin reaches nothing — an RFC 2606 `.invalid` host says
 * so at a glance, and keeps this parse independent of `NEXT_PUBLIC_APP_URL`,
 * whose absence would otherwise turn a state read into a configuration throw.
 */
const CALLBACK_URL_RESOLUTION_BASE = 'http://callback.invalid'

/**
 * Extracts a draft binding from Better Auth state and rejects malformed callback state.
 *
 * Better Auth documents `callbackURL` as a reference relative to the app
 * (`/dashboard`) and stores whatever it is handed verbatim, so a path and a full
 * URL are equally legitimate — these two shapes are what is accepted. Bare
 * `new URL()` rejects the path form, and because this runs inside the
 * `account.create.before` database hook, which Better Auth's OAuth callback does
 * not guard, that rejection surfaced as a 500 on the callback rather than a
 * failed connection.
 *
 * A network-path reference (`//host/path`, RFC 3986 §4.2) is not a path and
 * still throws, as does anything else malformed: a callback URL we cannot read
 * must stay loud rather than read as "carried no draft", which would fall back
 * to guessing the draft from the user and provider alone.
 */
export function parseCredentialDraftIdFromCallbackUrl(callbackUrl: unknown): string | undefined {
  if (callbackUrl === undefined) return undefined
  if (typeof callbackUrl !== 'string') {
    throw new Error('OAuth state callback URL must be a string')
  }
  const isPathAbsolute = callbackUrl.startsWith('/') && !callbackUrl.startsWith('//')
  const url = isPathAbsolute
    ? new URL(callbackUrl, CALLBACK_URL_RESOLUTION_BASE)
    : new URL(callbackUrl)
  return url.searchParams.get(OAUTH_CREDENTIAL_DRAFT_CALLBACK_PARAM) ?? undefined
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

  if (draft.organizationId && !draft.workspaceId) {
    await completeOrganizationCredentialDraft({
      draftId: draft.id,
      organizationId: draft.organizationId,
      userId,
      providerId,
      accountId,
    })
    return
  }
  if (!draft.workspaceId) throw new Error('Credential draft has no valid owner')
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
      draft: { ...draft, workspaceId: draft.workspaceId },
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
