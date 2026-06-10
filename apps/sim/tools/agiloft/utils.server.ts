import { createLogger } from '@sim/logger'
import {
  type SecureFetchResponse,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import type { AgiloftBaseParams } from '@/tools/agiloft/types'
import type { HttpMethod, ToolResponse } from '@/tools/types'

const logger = createLogger('AgiloftAuthServer')

interface AgiloftRequestConfig {
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
 * DNS-pinned variant of agiloftLogin. Requires a pre-resolved IP so the
 * connection cannot be steered to a different host between validation and
 * the actual TCP connection.
 */
export async function agiloftLoginPinned(
  params: AgiloftBaseParams,
  resolvedIP: string
): Promise<string> {
  const base = params.instanceUrl.replace(/\/$/, '')
  const kb = encodeURIComponent(params.knowledgeBase)
  const login = encodeURIComponent(params.login)
  const password = encodeURIComponent(params.password)

  const url = `${base}/ewws/EWLogin?$KB=${kb}&$login=${login}&$password=${password}`
  const response = await secureFetchWithPinnedIP(url, resolvedIP, { method: 'POST' })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Agiloft login failed: ${response.status} - ${errorText}`)
  }

  const data = (await response.json()) as { access_token?: string }
  const token = data.access_token

  if (!token) {
    throw new Error('Agiloft login did not return an access token')
  }

  return token
}

/**
 * DNS-pinned variant of agiloftLogout. Best-effort — failures are logged but
 * not thrown.
 */
export async function agiloftLogoutPinned(
  instanceUrl: string,
  knowledgeBase: string,
  token: string,
  resolvedIP: string
): Promise<void> {
  try {
    const base = instanceUrl.replace(/\/$/, '')
    const kb = encodeURIComponent(knowledgeBase)
    await secureFetchWithPinnedIP(`${base}/ewws/EWLogout?$KB=${kb}`, resolvedIP, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
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
  params: AgiloftBaseParams,
  buildRequest: (base: string) => AgiloftRequestConfig,
  transformResponse: (response: SecureFetchResponse) => Promise<R>
): Promise<R> {
  const resolvedIP = await resolveAgiloftInstance(params.instanceUrl)
  const token = await agiloftLoginPinned(params, resolvedIP)
  const base = params.instanceUrl.replace(/\/$/, '')

  try {
    const req = buildRequest(base)
    const response = await secureFetchWithPinnedIP(req.url, resolvedIP, {
      method: req.method,
      headers: {
        ...req.headers,
        Authorization: `Bearer ${token}`,
      },
      body: req.body,
    })
    return await transformResponse(response)
  } finally {
    await agiloftLogoutPinned(params.instanceUrl, params.knowledgeBase, token, resolvedIP)
  }
}

export type { SecureFetchResponse }
