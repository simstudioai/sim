import { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { filterUndefined } from '@sim/utils/object'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { stableExternalAccountId } from '@/lib/auth/connectors/account-id'
import { getBaseUrl } from '@/lib/core/utils/urls'
import {
  OAUTH_CREDENTIAL_ACCOUNT_CONFLICT_ERROR,
  OAUTH_CREDENTIAL_DRAFT_CALLBACK_PARAM,
} from '@/lib/credentials/draft-constants'
import {
  findConflictingWorkspaceCredential,
  handleCreateCredentialFromDraft,
  handleReconnectCredential,
} from '@/lib/credentials/draft-hooks'
import { completeOrganizationCredentialDraft } from '@/lib/credentials/organization-draft'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { clearOAuthRefreshFailure } from '@/lib/oauth/credential-service'
import { OAUTH_PROVIDERS } from '@/lib/oauth/oauth'
import type { OAuthProvider } from '@/lib/oauth/types'
import { parseProvider } from '@/lib/oauth/utils'

const logger = createLogger('CredentialDraftProcessor')

interface OAuthStateWithCallbackUrl {
  callbackURL?: unknown
  errorURL?: unknown
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

/**
 * Captures request-scoped OAuth state before Better Auth defers its account
 * after-hook, returning the draft id the state carries.
 */
export async function captureOAuthCredentialDraftBinding(
  context: object,
  loadOAuthState: () => Promise<OAuthStateWithCallbackUrl | null | undefined>
): Promise<string | undefined> {
  const binding = await loadOAuthCredentialDraftBinding(loadOAuthState)
  if (binding.status === 'unavailable') throw binding.error
  oauthCredentialDraftBindings.set(context, binding)
  return binding.draftId
}

/** Consumes the binding captured for the same Better Auth account-hook context. */
export function consumeOAuthCredentialDraftBinding(
  context: object
): AvailableOAuthCredentialDraftBinding | undefined {
  const binding = oauthCredentialDraftBindings.get(context)
  oauthCredentialDraftBindings.delete(context)
  return binding
}

interface CredentialReconnectConflictParams {
  draftId: string
  /** The account row Better Auth is about to insert, its `accountId` still carrying the random suffix. */
  account: {
    userId: string
    providerId: string
    accountId: string
    accessToken?: string | null
    refreshToken?: string | null
    idToken?: string | null
    accessTokenExpiresAt?: Date | null
    refreshTokenExpiresAt?: Date | null
    scope?: string | null
  }
  oauthState: OAuthStateWithCallbackUrl | null | undefined
}

/**
 * Decides, before Better Auth inserts the account row, whether completing this
 * reconnect draft would collide with another credential in its workspace.
 *
 * A new row for an external identity inherits every credential on that
 * identity's older rows (the stale-sibling migration in `account.create.after`),
 * so a reconnect onto an identity that already backs another credential in the
 * workspace would leave two credentials on one account. When it would, the
 * draft is discarded and this returns where to send the user: the page the
 * reconnect started from, carrying the reason as the `error` and
 * `error_description` the OAuth return handlers already read.
 *
 * Returning before the insert leaves every credential bound to the account it
 * had. The grant itself is still real, so its tokens replace the ones on the
 * identity's existing rows, the same tokens those credentials would have
 * inherited from the new row, and a provider that rotates on reauthorization
 * cannot strand them on a dead chain.
 */
export async function refuseConflictingCredentialReconnect(
  params: CredentialReconnectConflictParams
): Promise<string | null> {
  const { draftId, account, oauthState } = params
  const { userId, providerId } = account
  const stableIdentity = stableExternalAccountId(account.accountId)
  if (!stableIdentity) return null

  const [draft] = await db
    .select({
      credentialId: schema.pendingCredentialDraft.credentialId,
      workspaceId: schema.pendingCredentialDraft.workspaceId,
    })
    .from(schema.pendingCredentialDraft)
    .where(
      and(
        eq(schema.pendingCredentialDraft.id, draftId),
        eq(schema.pendingCredentialDraft.userId, userId),
        eq(schema.pendingCredentialDraft.providerId, providerId),
        sql`${schema.pendingCredentialDraft.expiresAt} > NOW()`
      )
    )
    .limit(1)
  if (!draft?.credentialId || !draft.workspaceId) return null

  const [reconnecting] = await db
    .select({ accountId: schema.credential.accountId })
    .from(schema.credential)
    .where(eq(schema.credential.id, draft.credentialId))
    .limit(1)
  if (!reconnecting) return null

  const identityAccountIds = (
    await db
      .select({ id: schema.account.id, accountId: schema.account.accountId })
      .from(schema.account)
      .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, providerId)))
  )
    .filter((row) => stableExternalAccountId(row.accountId) === stableIdentity)
    .map((row) => row.id)
  if (reconnecting.accountId && identityAccountIds.includes(reconnecting.accountId)) return null

  const conflicting = await findConflictingWorkspaceCredential({
    credentialId: draft.credentialId,
    workspaceId: draft.workspaceId,
    accountIds: identityAccountIds,
  })
  if (!conflicting) return null

  await db
    .update(schema.account)
    .set({
      ...filterUndefined({
        accessToken: account.accessToken ?? undefined,
        refreshToken: account.refreshToken ?? undefined,
        idToken: account.idToken ?? undefined,
        accessTokenExpiresAt: account.accessTokenExpiresAt ?? undefined,
        refreshTokenExpiresAt: account.refreshTokenExpiresAt ?? undefined,
        scope: account.scope ?? undefined,
      }),
      updatedAt: new Date(),
    })
    .where(inArray(schema.account.id, identityAccountIds))
  await Promise.all(identityAccountIds.map((id) => clearOAuthRefreshFailure(id)))

  await db
    .delete(schema.pendingCredentialDraft)
    .where(eq(schema.pendingCredentialDraft.id, draftId))

  logger.warn('Refused a credential reconnect onto an account another credential uses', {
    draftId,
    userId,
    providerId,
    credentialId: draft.credentialId,
    conflictingCredentialId: conflicting.id,
  })

  const returnUrl = [oauthState?.callbackURL, oauthState?.errorURL].find(
    (url): url is string => typeof url === 'string' && url.length > 0
  )
  const redirectUrl = new URL(returnUrl ?? APP_ENTRY_PATH, getBaseUrl())
  redirectUrl.searchParams.delete(OAUTH_CREDENTIAL_DRAFT_CALLBACK_PARAM)
  redirectUrl.searchParams.set('error', OAUTH_CREDENTIAL_ACCOUNT_CONFLICT_ERROR)
  redirectUrl.searchParams.set(
    'error_description',
    `That ${providerDisplayName(providerId)} account is already connected in this workspace as "${conflicting.displayName}". Use that connection, or reconnect with the account that belongs to this one.`
  )
  return redirectUrl.toString()
}

function providerDisplayName(providerId: string): string {
  const { baseProvider } = parseProvider(providerId as OAuthProvider)
  return OAUTH_PROVIDERS[baseProvider]?.name ?? 'provider'
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
