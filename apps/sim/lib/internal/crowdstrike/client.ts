import { toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { isRecordLike, toRecordOrNull } from '@sim/utils/object'
import { MAX_JSON_API_RESPONSE_BYTES } from '@/lib/core/security/input-validation.server'
import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import { throttledRetryAfterMs } from '@/lib/credentials/token-service-accounts/errors'
import type { CrowdStrikeCloud, CrowdStrikeInlineCredentials } from '@/tools/crowdstrike/types'

export type JsonRecord = Record<string, unknown>

const CLOUD_BASE_URLS: Record<CrowdStrikeCloud, string> = {
  'eu-1': 'https://api.eu-1.crowdstrike.com',
  'us-1': 'https://api.crowdstrike.com',
  'us-2': 'https://api.us-2.crowdstrike.com',
  'us-3': 'https://api.us-3.crowdstrike.com',
  'us-gov-1': 'https://api.laggar.gcw.crowdstrike.com',
  'us-gov-2': 'https://api.us-gov-2.crowdstrike.mil',
}

export function getCloudBaseUrl(cloud: CrowdStrikeCloud): string {
  return CLOUD_BASE_URLS[cloud]
}

/** Narrows an untrusted value to one of the Falcon clouds in {@link CLOUD_BASE_URLS}. */
export function isCrowdStrikeCloud(value: unknown): value is CrowdStrikeCloud {
  return typeof value === 'string' && Object.hasOwn(CLOUD_BASE_URLS, value)
}

export function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is string => typeof entry === 'string')
}

export function getRecordArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(isRecordLike)
}

export function getRecord(value: unknown): JsonRecord | null {
  return toRecordOrNull(value)
}

/**
 * Every Falcon endpoint this integration calls answers with a flat
 * `{ meta, resources, errors }` envelope, so the envelope readers below and
 * `getFalconErrorMessage` both read the payload root directly.
 */
export function getResourcesArray(data: unknown): unknown[] {
  if (!isRecordLike(data) || !Array.isArray(data.resources)) {
    return []
  }

  return data.resources
}

export function getRecordResources(data: unknown): JsonRecord[] {
  return getResourcesArray(data).filter(isRecordLike)
}

export function getStringResources(data: unknown): string[] {
  return getStringArray(getResourcesArray(data))
}

export function getFirstRecordResource(data: unknown): JsonRecord | null {
  return getRecordResources(data)[0] ?? null
}

export function getPagination(data: unknown) {
  if (!isRecordLike(data) || !isRecordLike(data.meta) || !isRecordLike(data.meta.pagination)) {
    return null
  }

  const { pagination } = data.meta

  return {
    limit: toNumberOrNull(pagination.limit),
    offset: toNumberOrNull(pagination.offset),
    total: toNumberOrNull(pagination.total),
  }
}

/** Offset pagination plus the `after` cursor the IOC Management API returns. */
export function getCursorPagination(data: unknown) {
  if (!isRecordLike(data) || !isRecordLike(data.meta) || !isRecordLike(data.meta.pagination)) {
    return null
  }

  const { pagination } = data.meta

  return {
    after: toStringOrNull(pagination.after),
    limit: toNumberOrNull(pagination.limit),
    offset: toNumberOrNull(pagination.offset),
    total: toNumberOrNull(pagination.total),
  }
}

/** Spotlight paginates by cursor only — it returns no offset. */
export function getSpotlightPagination(data: unknown) {
  if (!isRecordLike(data) || !isRecordLike(data.meta) || !isRecordLike(data.meta.pagination)) {
    return null
  }

  const { pagination } = data.meta

  return {
    after: toStringOrNull(pagination.after),
    limit: toNumberOrNull(pagination.limit),
    total: toNumberOrNull(pagination.total),
  }
}

/**
 * CrowdStrike returns `{ meta, resources, errors }` on every endpoint, and a 200
 * can still carry a populated `errors` array for the IDs that failed.
 */
export function getEnvelopeErrors(data: unknown) {
  if (!isRecordLike(data)) {
    return []
  }

  return getRecordArray(data.errors).map((entry) => ({
    code: toNumberOrNull(entry.code),
    id: toStringOrNull(entry.id),
    message: toStringOrNull(entry.message),
  }))
}

export function getFalconErrorMessage(data: unknown, fallback: string): string {
  if (!isRecordLike(data)) {
    return fallback
  }

  const errors = Array.isArray(data.errors) ? data.errors : []
  const firstError = errors[0]
  if (isRecordLike(firstError)) {
    const firstMessage = toStringOrNull(firstError.message) ?? toStringOrNull(firstError.code)
    if (firstMessage) {
      return firstMessage
    }
  }

  return (
    toStringOrNull(data.message) ??
    toStringOrNull(data.error_description) ??
    toStringOrNull(data.error) ??
    fallback
  )
}

/**
 * Raised when the Falcon OAuth2 token exchange fails. Carries the Falcon status
 * so the route can answer with the real cause (401 for bad credentials) instead
 * of letting a credential problem fall through to a generic 500.
 */
export class CrowdStrikeAuthError extends Error {
  readonly status: number

  constructor(
    message: string,
    status: number,
    /** The token endpoint's `Retry-After` on a 429 or 503, in milliseconds. */
    readonly retryAfterMs?: number
  ) {
    super(message)
    this.name = 'CrowdStrikeAuthError'
    this.status = status >= 400 && status <= 599 ? status : 502
  }
}

async function readFalconJson(response: Response, signal?: AbortSignal): Promise<unknown> {
  const text = await readResponseTextWithLimit(response, {
    maxBytes: MAX_JSON_API_RESPONSE_BYTES,
    label: 'CrowdStrike response body',
    signal,
  })

  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Falcon's documented lifetime for an access token, used when `expires_in` is unusable. */
const CROWDSTRIKE_TOKEN_LIFETIME_SECONDS = 30 * 60

/** A token response's `expires_in`, or Falcon's standard 30-minute lifetime when it is unusable. */
function getTokenLifetimeSeconds(expiresIn: unknown): number {
  return typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0
    ? expiresIn
    : CROWDSTRIKE_TOKEN_LIFETIME_SECONDS
}

/** API client credentials for one Falcon token request. */
interface CrowdStrikeTokenRequest extends CrowdStrikeInlineCredentials {
  /** The child CID an MSSP parent's token is locked to. */
  memberCid?: string
}

/**
 * Raised when a token request that does not follow redirects is answered with
 * one. Falcon redirects a token request sent to a cloud other than the API
 * client's own and names that cloud in `X-Cs-Region`; `region` carries it only
 * when it is one of the Falcon clouds Sim knows.
 */
export class CrowdStrikeTokenRedirectError extends Error {
  constructor(
    readonly status: number,
    readonly region: CrowdStrikeCloud | null
  ) {
    super('CrowdStrike token endpoint answered with a redirect')
    this.name = 'CrowdStrikeTokenRedirectError'
  }
}

/**
 * Exchanges API client credentials for a Falcon access token:
 * `POST {cloud API origin}/oauth2/token` with `client_id`, `client_secret`,
 * and, for an MSSP parent acting on one child, `member_cid`, as form fields.
 * With `followRedirects: false` a redirect is never followed and throws
 * {@link CrowdStrikeTokenRedirectError}, so the secret reaches no other host;
 * the legacy block's inline path keeps following one as it always has. A
 * refusal throws {@link CrowdStrikeAuthError} with Falcon's status and
 * `Retry-After`, even when its error body cannot be read.
 *
 * @see https://developer.crowdstrike.com/api-reference/collections/oauth2.md
 */
export async function requestCrowdStrikeToken(
  request: CrowdStrikeTokenRequest,
  options: { followRedirects: boolean; signal?: AbortSignal }
): Promise<{ token: string; expiresInSeconds: number }> {
  const { followRedirects, signal } = options
  signal?.throwIfAborted()
  const body = new URLSearchParams({
    client_id: request.clientId,
    client_secret: request.clientSecret,
    grant_type: 'client_credentials',
  })
  if (request.memberCid) body.set('member_cid', request.memberCid)

  const response = await fetch(`${getCloudBaseUrl(request.cloud)}/oauth2/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
    cache: 'no-store',
    redirect: followRedirects ? 'follow' : 'manual',
    signal,
  })

  if (!followRedirects && response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => {})
    const region = response.headers.get('x-cs-region')?.trim().toLowerCase()
    throw new CrowdStrikeTokenRedirectError(
      response.status,
      isCrowdStrikeCloud(region) ? region : null
    )
  }

  const data = response.ok
    ? await readFalconJson(response, signal)
    : await readFalconJson(response, signal).catch(() => null)
  signal?.throwIfAborted()
  if (!response.ok) {
    throw new CrowdStrikeAuthError(
      getFalconErrorMessage(data, 'Failed to authenticate with CrowdStrike'),
      response.status,
      throttledRetryAfterMs(response)
    )
  }
  if (!isRecordLike(data) || typeof data.access_token !== 'string' || !data.access_token.trim()) {
    throw new CrowdStrikeAuthError('CrowdStrike authentication did not return an access token', 502)
  }

  return {
    token: data.access_token,
    expiresInSeconds: getTokenLifetimeSeconds(data.expires_in),
  }
}

/**
 * A new token for inline (legacy block) credentials, minted for every request
 * as the legacy block always has, so a token Falcon has since revoked or
 * rescoped is never sent again.
 */
export async function getAccessToken(
  params: CrowdStrikeInlineCredentials,
  signal?: AbortSignal
): Promise<string> {
  const { token } = await requestCrowdStrikeToken(params, { followRedirects: true, signal })
  return token
}

interface CrowdStrikeRequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  query?: Record<string, string | number | boolean | undefined>
  repeatedQuery?: Record<string, string[] | undefined>
  body?: unknown
}

export interface CrowdStrikeCallResult {
  ok: boolean
  status: number
  data: unknown
}

export function buildUrl(baseUrl: string, options: CrowdStrikeRequestOptions): string {
  const url = new URL(options.path, baseUrl)

  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value))
    }
  }

  for (const [key, values] of Object.entries(options.repeatedQuery ?? {})) {
    for (const value of values ?? []) {
      url.searchParams.append(key, value)
    }
  }

  return url.toString()
}

export async function callCrowdStrike(
  baseUrl: string,
  accessToken: string,
  options: CrowdStrikeRequestOptions,
  signal?: AbortSignal
): Promise<CrowdStrikeCallResult> {
  signal?.throwIfAborted()
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
  }

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  const response = await fetch(buildUrl(baseUrl, options), {
    method: options.method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: 'no-store',
    signal,
  })

  const data = await readFalconJson(response)
  signal?.throwIfAborted()

  return { ok: response.ok, status: response.status, data }
}
