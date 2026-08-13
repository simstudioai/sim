import { createLogger } from '@sim/logger'
import { filterUndefined } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import {
  type SecureFetchResponse,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import type { AgiloftBaseParams, AgiloftCredentials } from '@/tools/agiloft/types'
import { AGILOFT_LANG, agiloftAlrestBase, describeAgiloftError } from '@/tools/agiloft/utils'
import type { HttpMethod, ToolResponse } from '@/tools/types'

const logger = createLogger('AgiloftAuthServer')

export interface AgiloftRequestConfig {
  url: string
  method: HttpMethod
  headers?: Record<string, string>
  body?: string
}

/**
 * Validates the Agiloft instance URL and resolves its DNS once, returning the
 * resolved IP so subsequent requests can pin to it. This prevents DNS-rebinding
 * (TOCTOU) SSRF where the hostname could resolve to a private IP on a later
 * lookup. Server-only — uses node:dns/promises.
 */
export async function resolveAgiloftInstance(instanceUrl: string): Promise<string> {
  const validation = await validateUrlWithDNS(instanceUrl, 'instanceUrl')
  if (!validation.isValid || !validation.resolvedIP) {
    throw new Error(validation.error || 'Invalid Agiloft instance URL')
  }
  return validation.resolvedIP
}

/**
 * Serializes credentials the way EWLogin expects them.
 *
 * The parameters go in a form-encoded request body rather than the query
 * string: Agiloft's own documentation notes they "can be filled to request
 * body", and it keeps the password out of URLs, access logs, and proxy traces.
 */
function formEncode(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
}

export interface AgiloftSession {
  /** Ready-to-send Authorization header value, e.g. `Bearer eyJ...`. */
  authorization: string
  token: string
}

/**
 * DNS-pinned login. Requires a pre-resolved IP so the connection cannot be
 * steered to a different host between validation and the actual TCP connect.
 *
 * `$table` and `$lang` are as mandatory as `$KB` here even though only `$KB`,
 * `$login`, `$password`, and `$lang` are documented — a live instance rejects
 * the call with:
 *
 *   EWWrongDataException ... One has to specify $table, $KB, $lang parameters
 *
 * The scheme is read back from `authentication_scheme` rather than hardcoded,
 * because Agiloft returns it with a trailing space ("Bearer ") and naively
 * concatenating it yields a malformed `Bearer  <token>` header.
 */
export async function agiloftLoginPinned(
  params: AgiloftCredentials,
  resolvedIP: string
): Promise<AgiloftSession> {
  const base = params.instanceUrl.replace(/\/$/, '')

  const response = await secureFetchWithPinnedIP(`${base}/ewws/EWLogin`, resolvedIP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formEncode(
      filterUndefined({
        $KB: params.knowledgeBase,
        $login: params.login,
        $password: params.password,
        // Undocumented on EWLogin, but a live instance rejects the call without
        // it. Omitted for KB-scoped operations that have no table.
        $table: params.table || undefined,
        $lang: AGILOFT_LANG,
      })
    ),
  })

  const text = await response.text()

  if (!response.ok) {
    throw new Error(`Agiloft login failed (${response.status}): ${describeAgiloftError(text)}`)
  }

  let data: { access_token?: string; authentication_scheme?: string }
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`Agiloft login returned a non-JSON response: ${truncate(text, 200)}`)
  }

  if (!data.access_token) {
    throw new Error(`Agiloft login did not return an access token: ${truncate(text, 200)}`)
  }

  const scheme = (data.authentication_scheme || 'Bearer').trim() || 'Bearer'
  return { authorization: `${scheme} ${data.access_token}`, token: data.access_token }
}

/**
 * DNS-pinned variant of agiloftLogout. Best-effort — failures are logged but
 * not thrown.
 */
export async function agiloftLogoutPinned(
  instanceUrl: string,
  knowledgeBase: string,
  authorization: string,
  resolvedIP: string
): Promise<void> {
  try {
    const base = instanceUrl.replace(/\/$/, '')
    const kb = encodeURIComponent(knowledgeBase)
    await secureFetchWithPinnedIP(
      `${base}/ewws/EWLogout?$KB=${kb}&$lang=${AGILOFT_LANG}`,
      resolvedIP,
      {
        method: 'POST',
        headers: { Authorization: authorization },
      }
    )
  } catch (error) {
    logger.warn('Agiloft logout failed (best-effort)', { error })
  }
}

/**
 * Shared wrapper that handles the full Agiloft auth lifecycle behind the
 * codebase's SSRF-safe fetch path. The instance URL is validated and resolved
 * to a concrete IP once via `validateUrlWithDNS` (which rejects hostnames that
 * resolve to private/reserved addresses), and every hop — login, the operation
 * request, and logout — is issued through `secureFetchWithPinnedIP` so the
 * connection is pinned to that validated IP. This defeats DNS-rebinding (TOCTOU)
 * SSRF where a hostname could resolve to an internal address on a later lookup.
 *
 * 1. Validate + resolve the instance URL once.
 * 2. Login to obtain a Bearer token.
 * 3. Execute the operation request with the token.
 * 4. Logout to clean up the session (best-effort).
 *
 * The `buildRequest` callback receives the base URL and returns the request
 * config. The `transformResponse` callback converts the raw response into the
 * tool's output format.
 *
 * Server-only — uses node:dns/promises and node:http(s) via the pinned fetch.
 */
export async function executeAgiloftRequest<R extends ToolResponse>(
  params: AgiloftCredentials,
  buildRequest: (base: string) => AgiloftRequestConfig,
  transformResponse: (response: SecureFetchResponse) => Promise<R>
): Promise<R> {
  const resolvedIP = await resolveAgiloftInstance(params.instanceUrl)
  const session = await agiloftLoginPinned(params, resolvedIP)
  const base = params.instanceUrl.replace(/\/$/, '')

  try {
    const req = buildRequest(base)
    const response = await secureFetchWithPinnedIP(req.url, resolvedIP, {
      method: req.method,
      headers: {
        ...req.headers,
        Authorization: session.authorization,
      },
      body: req.body,
    })
    return await transformResponse(response)
  } finally {
    await agiloftLogoutPinned(
      params.instanceUrl,
      params.knowledgeBase,
      session.authorization,
      resolvedIP
    )
  }
}

export type { SecureFetchResponse }

/**
 * Shape every `/ewws/alrest` endpoint answers with.
 *
 * The surface reports failures as HTTP 200 with `success: false`, so checking
 * `response.ok` alone silently turns an upstream refusal into a successful
 * empty result. `readAlrestJson` is the only sanctioned way to read one.
 */
export interface AlrestEnvelope<T> {
  success?: boolean
  message?: string
  errors?: Array<{ message?: string }>
  result?: T
}

export class AgiloftAlrestError extends Error {}

/**
 * True for an upstream refusal Agiloft already decided on — a validation error,
 * a permission denial, a conflicting match.
 *
 * These must not surface as HTTP 500: the tool runner treats 500 as retryable,
 * and retrying a refused create can duplicate a record rather than converge.
 */
export function isAgiloftRefusal(error: unknown): error is AgiloftAlrestError {
  return error instanceof AgiloftAlrestError
}

/**
 * Parses an alrest envelope, throwing `AgiloftAlrestError` when the call failed
 * — whether it failed by status code, by `success: false`, or by returning
 * something that is not JSON at all.
 */
export async function readAlrestJson<T>(response: SecureFetchResponse): Promise<T | undefined> {
  const text = await response.text()

  let envelope: AlrestEnvelope<T>
  try {
    envelope = JSON.parse(text)
  } catch {
    throw new AgiloftAlrestError(
      `Agiloft returned a non-JSON response (${response.status}): ${truncate(text, 300)}`
    )
  }

  if (!response.ok || envelope.success === false) {
    const detail =
      envelope.errors
        ?.map((entry) => entry?.message)
        .filter(Boolean)
        .join('; ') ||
      envelope.message ||
      describeAgiloftError(truncate(text, 300))
    throw new AgiloftAlrestError(`Agiloft error: ${detail}`)
  }

  return envelope.result
}

/**
 * Runs a single authenticated `/ewws/alrest/{KB}` call. `buildRequest` receives
 * the KB-scoped base URL, so callers compose `${base}/{table}/...` paths.
 */
export async function executeAlrestRequest<R extends ToolResponse>(
  params: AgiloftBaseParams,
  buildRequest: (base: string) => AgiloftRequestConfig,
  transformResponse: (response: SecureFetchResponse) => Promise<R>
): Promise<R> {
  const resolvedIP = await resolveAgiloftInstance(params.instanceUrl)
  const session = await agiloftLoginPinned(params, resolvedIP)

  try {
    const req = buildRequest(agiloftAlrestBase(params.instanceUrl, params.knowledgeBase))
    const response = await secureFetchWithPinnedIP(req.url, resolvedIP, {
      method: req.method,
      headers: { ...req.headers, Authorization: session.authorization },
      body: req.body,
    })
    return await transformResponse(response)
  } finally {
    await agiloftLogoutPinned(
      params.instanceUrl,
      params.knowledgeBase,
      session.authorization,
      resolvedIP
    )
  }
}

/**
 * Runs a single `/ewws/EW*` call. No login round-trip: that surface rejects the
 * bearer token and authenticates from the inline `$login`/`$password` already
 * present in the URL built by the caller.
 */
export async function executeEwRequest<R extends ToolResponse>(
  params: AgiloftCredentials,
  buildRequest: (base: string) => AgiloftRequestConfig,
  transformResponse: (response: SecureFetchResponse) => Promise<R>
): Promise<R> {
  const resolvedIP = await resolveAgiloftInstance(params.instanceUrl)
  const req = buildRequest(params.instanceUrl.replace(/\/$/, ''))
  const response = await secureFetchWithPinnedIP(req.url, resolvedIP, {
    method: req.method,
    headers: req.headers,
    body: req.body,
  })
  return await transformResponse(response)
}
