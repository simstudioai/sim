'use client'

import { generateShortId } from '@sim/utils/id'

export const OAUTH_CHAT_ATTEMPT_PARAM = 'oauthAttempt'
export const OAUTH_CHAT_ATTEMPT_EVENT = 'sim:oauth-chat-attempt'
export const OAUTH_CHAT_COMPLETE_PATH = '/oauth/chat-complete'
export const OAUTH_CHAT_RETURN_TO_PARAM = 'returnTo'

const OAUTH_CHAT_ATTEMPT_KEY_PREFIX = 'sim.oauth-chat-attempt.'
const OAUTH_CHAT_LATEST_KEY_PREFIX = 'sim.oauth-chat-latest.'
const ACTIVE_DESKTOP_ATTEMPT_KEY = 'sim.oauth-chat-active-desktop-attempt'
export const OAUTH_CHAT_ATTEMPT_MAX_AGE_MS = 15 * 60 * 1000

export type OAuthChatAttemptStatus = 'pending' | 'connected' | 'failed'

export interface OAuthCredentialRecord {
  id: string
  providerId: string | null
  updatedAt: string
}

export interface OAuthCredentialTarget {
  providerId: string
  baseProviderId: string
  credentialId?: string
  /**
   * Alternate authorization servers whose credentials authenticate this same
   * service (`salesforce-sandbox`). Supplied by the caller rather than resolved
   * here so this module stays free of the OAuth provider registry, which would
   * otherwise pull icon components into the chat bundle.
   */
  additionalProviderIds?: readonly string[]
}

export interface OAuthCredentialBaseline {
  baselineCredentialIds: string[]
  baselineCredentialUpdatedAt?: string
}

export interface OAuthChatAttempt {
  id: string
  workspaceId: string
  providerId: string
  baseProviderId: string
  /**
   * See {@link OAuthCredentialTarget.additionalProviderIds}. Persisted on the
   * attempt because the post-connect verification leg re-reads the stored
   * attempt rather than the live target — without it, a credential from an
   * alternate authorization server would not register as "connected".
   * Absent on attempts written before this existed; those simply match as they
   * did, and attempts expire after {@link OAUTH_CHAT_ATTEMPT_MAX_AGE_MS}.
   */
  additionalProviderIds?: readonly string[]
  displayName: string
  controlId: string
  credentialId?: string
  baselineCredentialIds: string[]
  baselineCredentialUpdatedAt?: string
  requestedAt: number
  status: OAuthChatAttemptStatus
}

interface CreateOAuthChatAttemptInput {
  workspaceId: string
  providerId: string
  baseProviderId: string
  /** See {@link OAuthCredentialTarget.additionalProviderIds}. */
  additionalProviderIds?: readonly string[]
  displayName: string
  controlId: string
  credentialId?: string
  baselineCredentialIds: string[]
  baselineCredentialUpdatedAt?: string
}

function credentialsForTarget(
  target: OAuthCredentialTarget,
  credentials: readonly OAuthCredentialRecord[]
): readonly OAuthCredentialRecord[] {
  if (target.credentialId) {
    return credentials.filter((credential) => credential.id === target.credentialId)
  }
  return credentials.filter(
    (credential) =>
      credential.providerId === target.providerId ||
      credential.providerId === target.baseProviderId ||
      (credential.providerId !== null &&
        (target.additionalProviderIds?.includes(credential.providerId) ?? false))
  )
}

/** Whether the workspace already holds a credential this chip would connect. */
export function hasOAuthCredentialForTarget(
  target: OAuthCredentialTarget,
  credentials: readonly OAuthCredentialRecord[]
): boolean {
  return credentialsForTarget(target, credentials).length > 0
}

export function getOAuthCredentialBaseline(
  target: OAuthCredentialTarget,
  credentials: readonly OAuthCredentialRecord[]
): OAuthCredentialBaseline {
  const matchingCredentials = credentialsForTarget(target, credentials)
  return {
    baselineCredentialIds: matchingCredentials.map((credential) => credential.id),
    baselineCredentialUpdatedAt: target.credentialId
      ? matchingCredentials[0]?.updatedAt
      : undefined,
  }
}

export function hasOAuthCredentialChanged(
  target: OAuthCredentialTarget & OAuthCredentialBaseline,
  credentials: readonly OAuthCredentialRecord[]
): boolean {
  const matchingCredentials = credentialsForTarget(target, credentials)
  if (target.credentialId) {
    const credential = matchingCredentials[0]
    if (!credential) return false
    if (target.baselineCredentialUpdatedAt) {
      return credential.updatedAt !== target.baselineCredentialUpdatedAt
    }
    return !target.baselineCredentialIds.includes(credential.id)
  }
  return matchingCredentials.some(
    (credential) => !target.baselineCredentialIds.includes(credential.id)
  )
}

function attemptStorageKey(attemptId: string): string {
  return `${OAUTH_CHAT_ATTEMPT_KEY_PREFIX}${attemptId}`
}

function latestAttemptStorageKey(input: {
  workspaceId: string
  providerId: string
  controlId: string
  credentialId?: string
}): string {
  return `${OAUTH_CHAT_LATEST_KEY_PREFIX}${encodeURIComponent(input.workspaceId)}.${encodeURIComponent(input.providerId)}.${encodeURIComponent(input.controlId)}.${encodeURIComponent(input.credentialId ?? '')}`
}

function isOAuthChatAttempt(value: unknown): value is OAuthChatAttempt {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<OAuthChatAttempt>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.workspaceId === 'string' &&
    typeof candidate.providerId === 'string' &&
    typeof candidate.baseProviderId === 'string' &&
    typeof candidate.displayName === 'string' &&
    typeof candidate.controlId === 'string' &&
    typeof candidate.requestedAt === 'number' &&
    (candidate.status === 'pending' ||
      candidate.status === 'connected' ||
      candidate.status === 'failed') &&
    (candidate.credentialId === undefined || typeof candidate.credentialId === 'string') &&
    Array.isArray(candidate.baselineCredentialIds) &&
    candidate.baselineCredentialIds.every((credentialId) => typeof credentialId === 'string') &&
    (candidate.baselineCredentialUpdatedAt === undefined ||
      typeof candidate.baselineCredentialUpdatedAt === 'string')
  )
}

function writeOAuthChatAttempt(attempt: OAuthChatAttempt): void {
  if (typeof window === 'undefined') return
  // A blocked or full store must not throw into the caller: the chat-complete
  // page writes the verdict before closing its window, so an unguarded throw
  // would strand the popup open instead of losing only the verdict.
  try {
    window.localStorage.setItem(attemptStorageKey(attempt.id), JSON.stringify(attempt))
    window.localStorage.setItem(latestAttemptStorageKey(attempt), attempt.id)
  } catch {}
  window.dispatchEvent(
    new CustomEvent<OAuthChatAttempt>(OAUTH_CHAT_ATTEMPT_EVENT, { detail: attempt })
  )
}

export function createOAuthChatAttempt(input: CreateOAuthChatAttemptInput): OAuthChatAttempt {
  const attempt: OAuthChatAttempt = {
    ...input,
    id: generateShortId(24),
    requestedAt: Date.now(),
    status: 'pending',
  }
  writeOAuthChatAttempt(attempt)
  return attempt
}

export function readOAuthChatAttempt(attemptId: string): OAuthChatAttempt | null {
  if (typeof window === 'undefined') return null
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(attemptStorageKey(attemptId)) ?? 'null'
    ) as unknown
    return isOAuthChatAttempt(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function readLatestOAuthChatAttempt(input: {
  workspaceId: string
  providerId: string
  controlId: string
  credentialId?: string
}): OAuthChatAttempt | null {
  if (typeof window === 'undefined') return null
  const attemptId = window.localStorage.getItem(latestAttemptStorageKey(input))
  if (!attemptId) return null
  const attempt = readOAuthChatAttempt(attemptId)
  if (!attempt || Date.now() - attempt.requestedAt > OAUTH_CHAT_ATTEMPT_MAX_AGE_MS) return null
  return attempt
}

export function setOAuthChatAttemptStatus(
  attemptId: string,
  status: OAuthChatAttemptStatus
): OAuthChatAttempt | null {
  const attempt = readOAuthChatAttempt(attemptId)
  if (!attempt) return null
  const updated = { ...attempt, status }
  writeOAuthChatAttempt(updated)
  return updated
}

export function setActiveDesktopOAuthChatAttempt(attemptId: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(ACTIVE_DESKTOP_ATTEMPT_KEY, attemptId)
}

export function clearActiveDesktopOAuthChatAttempt(attemptId: string): void {
  if (typeof window === 'undefined') return
  if (window.localStorage.getItem(ACTIVE_DESKTOP_ATTEMPT_KEY) === attemptId) {
    window.localStorage.removeItem(ACTIVE_DESKTOP_ATTEMPT_KEY)
  }
}

export function resolveActiveDesktopOAuthChatAttempt(
  status: Extract<OAuthChatAttemptStatus, 'connected' | 'failed'>
): OAuthChatAttempt | null {
  if (typeof window === 'undefined') return null
  const attemptId = window.localStorage.getItem(ACTIVE_DESKTOP_ATTEMPT_KEY)
  if (!attemptId) return null
  window.localStorage.removeItem(ACTIVE_DESKTOP_ATTEMPT_KEY)
  return setOAuthChatAttemptStatus(attemptId, status)
}

/**
 * Resolves the exact chat attempt echoed by a current desktop shell. A null
 * correlation explicitly means an ordinary integrations-page flow and must
 * not consume a stale chat attempt. Only legacy shells omit the field, in
 * which case the former single-active-attempt behavior remains as a fallback.
 */
export function resolveDesktopOAuthChatAttempt(
  result: { chatAttemptId?: string | null },
  status: Extract<OAuthChatAttemptStatus, 'connected' | 'failed'>
): OAuthChatAttempt | null {
  if (Object.hasOwn(result, 'chatAttemptId')) {
    if (!result.chatAttemptId) return null
    clearActiveDesktopOAuthChatAttempt(result.chatAttemptId)
    return setOAuthChatAttemptStatus(result.chatAttemptId, status)
  }
  return resolveActiveDesktopOAuthChatAttempt(status)
}

function appendAttemptToReturnUrl(rawReturnUrl: string, attemptId: string): string {
  const returnUrl = new URL(rawReturnUrl, window.location.origin)
  returnUrl.searchParams.set(OAUTH_CHAT_ATTEMPT_PARAM, attemptId)
  return returnUrl.toString()
}

interface AuthorizeReturnTarget {
  authorizeUrl: URL
  /** Which param this provider's authorize route reads the return URL from. */
  returnParam: 'callbackURL' | 'returnUrl'
  rawReturnUrl: string | null
}

/**
 * Locates the return URL an authorize link will come back through. Shared so
 * both builders below agree on which param carries it — a provider added to
 * one and missed in the other would break only the path its caller uses.
 */
function resolveAuthorizeReturnTarget(rawUrl: string): AuthorizeReturnTarget {
  const authorizeUrl = new URL(rawUrl, window.location.origin)
  const returnParam = authorizeUrl.searchParams.has('callbackURL') ? 'callbackURL' : 'returnUrl'
  return {
    authorizeUrl,
    returnParam,
    rawReturnUrl: authorizeUrl.searchParams.get(returnParam),
  }
}

/** Adds the attempt id to the eventual same-origin OAuth return URL. */
export function addOAuthChatAttemptToAuthorizeUrl(rawUrl: string, attemptId: string): string {
  const { authorizeUrl, returnParam, rawReturnUrl } = resolveAuthorizeReturnTarget(rawUrl)

  if (rawReturnUrl) {
    authorizeUrl.searchParams.set(returnParam, appendAttemptToReturnUrl(rawReturnUrl, attemptId))
  } else {
    authorizeUrl.searchParams.set(OAUTH_CHAT_ATTEMPT_PARAM, attemptId)
  }

  return authorizeUrl.toString()
}

/**
 * Chat-flavored authorize URL: the return leg lands on the lightweight
 * chat-complete page — which publishes the verdict and closes the window —
 * instead of reloading the whole app in the OAuth window.
 *
 * The complete page's fallback redirect target is the plain return URL with no
 * attempt id, so a window that cannot close lands on the chat surface without
 * its return router re-deciding a verdict the completion page already
 * published.
 *
 * Returns null when the authorize URL is not a same-origin Sim route, or
 * carries no return param to rewrite; the caller falls back to
 * {@link addOAuthChatAttemptToAuthorizeUrl} and its plain anchor navigation.
 */
export function buildOAuthChatCompleteAuthorizeUrl(
  rawUrl: string,
  attemptId: string
): string | null {
  const { authorizeUrl, returnParam, rawReturnUrl } = resolveAuthorizeReturnTarget(rawUrl)
  // The connect URL is streamed model output, checked only for a safe protocol.
  // Refusing a foreign origin here keeps the attempt id out of a URL we do not
  // control, and keeps the caller on its anchor — whose rel='noopener' the
  // popup path would otherwise drop, handing a hostile page our window handle.
  if (authorizeUrl.origin !== window.location.origin) return null
  if (!rawReturnUrl) return null

  // Anchored on the return URL the server generated, not this tab's origin —
  // both the authorize route and the custom-provider callbacks accept a return
  // target only when it matches the deployment's configured base URL, which a
  // proxied or aliased origin need not equal.
  const completeUrl = new URL(
    OAUTH_CHAT_COMPLETE_PATH,
    new URL(rawReturnUrl, window.location.origin).origin
  )
  completeUrl.searchParams.set(OAUTH_CHAT_ATTEMPT_PARAM, attemptId)
  completeUrl.searchParams.set(OAUTH_CHAT_RETURN_TO_PARAM, rawReturnUrl)
  authorizeUrl.searchParams.set(returnParam, completeUrl.toString())
  return authorizeUrl.toString()
}
