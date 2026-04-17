import { createLogger } from '@sim/logger'
import type { SecureFetchResponse } from '@/lib/core/security/input-validation.server'
import type {
  AgiloftAttachmentInfoParams,
  AgiloftBaseParams,
  AgiloftDeleteRecordParams,
  AgiloftLockRecordParams,
  AgiloftReadRecordParams,
  AgiloftRemoveAttachmentParams,
  AgiloftRetrieveAttachmentParams,
  AgiloftSavedSearchParams,
  AgiloftSearchRecordsParams,
  AgiloftSelectRecordsParams,
} from '@/tools/agiloft/types'
import type { HttpMethod, ToolResponse } from '@/tools/types'

const logger = createLogger('AgiloftAuth')

/**
 * Lazily imports server-only security functions to avoid pulling `dns/promises`
 * into client bundles (this file is reachable from tools/registry.ts).
 */
async function getServerSecurity() {
  const mod = await import('@/lib/core/security/input-validation.server')
  return {
    secureFetchWithPinnedIP: mod.secureFetchWithPinnedIP,
    validateUrlWithDNS: mod.validateUrlWithDNS,
  }
}

interface AgiloftRequestConfig {
  url: string
  method: HttpMethod
  headers?: Record<string, string>
  body?: BodyInit
}

/**
 * Validates the instance URL via DNS resolution and returns the resolved IP
 * for use with pinned fetches to prevent SSRF via DNS rebinding.
 */
async function validateInstanceUrl(instanceUrl: string): Promise<string> {
  const { validateUrlWithDNS } = await getServerSecurity()
  const validation = await validateUrlWithDNS(instanceUrl, 'instanceUrl')
  if (!validation.isValid) {
    throw new Error(`Invalid Agiloft instance URL: ${validation.error}`)
  }
  return validation.resolvedIP!
}

/**
 * Exchanges login/password for a short-lived Bearer token via EWLogin.
 * Uses DNS-pinned fetch to prevent SSRF via DNS rebinding.
 */
async function agiloftLogin(params: AgiloftBaseParams, resolvedIP: string): Promise<string> {
  const base = params.instanceUrl.replace(/\/$/, '')

  const kb = encodeURIComponent(params.knowledgeBase)
  const login = encodeURIComponent(params.login)
  const password = encodeURIComponent(params.password)

  const url = `${base}/ewws/EWLogin?$KB=${kb}&$login=${login}&$password=${password}`
  const { secureFetchWithPinnedIP } = await getServerSecurity()
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
 * Cleans up the server session. Best-effort — failures are logged but not thrown.
 * Uses DNS-pinned fetch to prevent SSRF via DNS rebinding.
 */
async function agiloftLogout(
  instanceUrl: string,
  knowledgeBase: string,
  token: string,
  resolvedIP: string
): Promise<void> {
  try {
    const base = instanceUrl.replace(/\/$/, '')
    const kb = encodeURIComponent(knowledgeBase)
    const { secureFetchWithPinnedIP } = await getServerSecurity()
    await secureFetchWithPinnedIP(`${base}/ewws/EWLogout?$KB=${kb}`, resolvedIP, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (error) {
    logger.warn('Agiloft logout failed (best-effort)', { error })
  }
}

/**
 * Shared wrapper that handles the full auth lifecycle:
 * 1. Validate instance URL via DNS resolution
 * 2. Login to get Bearer token (using pinned IP)
 * 3. Execute the request with the token (using pinned IP)
 * 4. Logout to clean up the session (using pinned IP)
 *
 * All HTTP requests use the resolved IP to prevent SSRF via DNS rebinding.
 */
export async function executeAgiloftRequest<R extends ToolResponse>(
  params: AgiloftBaseParams,
  buildRequest: (base: string) => AgiloftRequestConfig,
  transformResponse: (response: SecureFetchResponse) => Promise<R>
): Promise<R> {
  const resolvedIP = await validateInstanceUrl(params.instanceUrl)
  const token = await agiloftLogin(params, resolvedIP)
  const base = params.instanceUrl.replace(/\/$/, '')

  try {
    const req = buildRequest(base)
    const { secureFetchWithPinnedIP } = await getServerSecurity()
    const response = await secureFetchWithPinnedIP(req.url, resolvedIP, {
      method: req.method,
      headers: {
        ...req.headers,
        Authorization: `Bearer ${token}`,
      },
      body: req.body as string | Buffer | Uint8Array | undefined,
    })
    return await transformResponse(response)
  } finally {
    await agiloftLogout(params.instanceUrl, params.knowledgeBase, token, resolvedIP)
  }
}

/**
 * Login helper exported for use in the attach file API route.
 */
export { agiloftLogin, agiloftLogout, validateInstanceUrl }

/** URL builders (credential-free -- auth is via Bearer token header) */

function encodeTable(params: AgiloftBaseParams) {
  return {
    kb: encodeURIComponent(params.knowledgeBase),
    table: encodeURIComponent(params.table),
  }
}

export function buildCreateRecordUrl(base: string, params: AgiloftBaseParams): string {
  const { kb, table } = encodeTable(params)
  return `${base}/ewws/REST/${kb}/${table}?$lang=en`
}

export function buildReadRecordUrl(base: string, params: AgiloftReadRecordParams): string {
  const { kb, table } = encodeTable(params)
  const id = encodeURIComponent(params.recordId.trim())
  let url = `${base}/ewws/REST/${kb}/${table}/${id}?$lang=en`

  if (params.fields) {
    const fieldList = params.fields
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean)
    for (const field of fieldList) {
      url += `&$fields=${encodeURIComponent(field)}`
    }
  }

  return url
}

export function buildUpdateRecordUrl(
  base: string,
  params: AgiloftBaseParams & { recordId: string }
): string {
  const { kb, table } = encodeTable(params)
  const id = encodeURIComponent(params.recordId.trim())
  return `${base}/ewws/REST/${kb}/${table}/${id}?$lang=en`
}

export function buildDeleteRecordUrl(base: string, params: AgiloftDeleteRecordParams): string {
  const { kb, table } = encodeTable(params)
  const id = encodeURIComponent(params.recordId.trim())
  return `${base}/ewws/REST/${kb}/${table}/${id}?$lang=en`
}

function buildEwBaseQuery(params: AgiloftBaseParams): string {
  const { kb, table } = encodeTable(params)
  return `$KB=${kb}&$table=${table}&$lang=en`
}

export function buildSearchRecordsUrl(base: string, params: AgiloftSearchRecordsParams): string {
  const query = encodeURIComponent(params.query)
  let url = `${base}/ewws/EWSearch/.json?${buildEwBaseQuery(params)}&query=${query}`

  if (params.fields) {
    const fieldList = params.fields
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean)
    for (const field of fieldList) {
      url += `&field=${encodeURIComponent(field)}`
    }
  }

  if (params.page) {
    url += `&page=${encodeURIComponent(params.page)}`
  }
  if (params.limit) {
    url += `&limit=${encodeURIComponent(params.limit)}`
  }

  return url
}

export function buildSelectRecordsUrl(base: string, params: AgiloftSelectRecordsParams): string {
  const where = encodeURIComponent(params.where)
  return `${base}/ewws/EWSelect/.json?${buildEwBaseQuery(params)}&where=${where}`
}

export function buildSavedSearchUrl(base: string, params: AgiloftSavedSearchParams): string {
  return `${base}/ewws/EWSavedSearch/.json?${buildEwBaseQuery(params)}`
}

export function buildRetrieveAttachmentUrl(
  base: string,
  params: AgiloftRetrieveAttachmentParams
): string {
  const id = encodeURIComponent(params.recordId.trim())
  const field = encodeURIComponent(params.fieldName.trim())
  const position = encodeURIComponent(params.position)
  return `${base}/ewws/EWRetrieve?${buildEwBaseQuery(params)}&id=${id}&field=${field}&filePosition=${position}`
}

export function buildRemoveAttachmentUrl(
  base: string,
  params: AgiloftRemoveAttachmentParams
): string {
  const id = encodeURIComponent(params.recordId.trim())
  const field = encodeURIComponent(params.fieldName.trim())
  const position = encodeURIComponent(params.position)
  return `${base}/ewws/EWRemoveAttachment?${buildEwBaseQuery(params)}&id=${id}&field=${field}&filePosition=${position}`
}

export function buildAttachmentInfoUrl(base: string, params: AgiloftAttachmentInfoParams): string {
  const id = encodeURIComponent(params.recordId.trim())
  const fieldName = encodeURIComponent(params.fieldName.trim())
  return `${base}/ewws/EWAttachInfo/.json?${buildEwBaseQuery(params)}&id=${id}&field=${fieldName}`
}

export function buildLockRecordUrl(base: string, params: AgiloftLockRecordParams): string {
  const id = encodeURIComponent(params.recordId.trim())
  return `${base}/ewws/EWLock/.json?${buildEwBaseQuery(params)}&id=${id}`
}

export function buildAttachFileUrl(
  base: string,
  params: AgiloftBaseParams & { recordId: string; fieldName: string },
  fileName: string
): string {
  const { kb, table } = encodeTable(params)
  const recordId = encodeURIComponent(params.recordId.trim())
  const fieldName = encodeURIComponent(params.fieldName.trim())
  const encodedFileName = encodeURIComponent(fileName)
  return `${base}/ewws/EWAttach?$KB=${kb}&$table=${table}&$lang=en&id=${recordId}&field=${fieldName}&fileName=${encodedFileName}`
}

export function getLockHttpMethod(lockAction: string): HttpMethod {
  switch (lockAction) {
    case 'lock':
      return 'PUT'
    case 'unlock':
      return 'DELETE'
    default:
      return 'GET'
  }
}
