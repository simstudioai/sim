import { createLogger } from '@sim/logger'
import {
  type SecureFetchResponse,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import type { AgiloftBaseParams } from '@/tools/agiloft/types'

const logger = createLogger('AgiloftAuthServer')

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

export type { SecureFetchResponse }
