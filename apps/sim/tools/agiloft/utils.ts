import { createLogger } from '@sim/logger'
import { validateExternalUrl } from '@/lib/core/security/input-validation'
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

interface AgiloftRequestConfig {
  url: string
  method: HttpMethod
  headers?: Record<string, string>
  body?: BodyInit
}

/**
 * Exchanges login/password for a short-lived Bearer token via EWLogin.
 */
async function agiloftLogin(params: AgiloftBaseParams): Promise<string> {
  const base = params.instanceUrl.replace(/\/$/, '')

  const urlValidation = validateExternalUrl(params.instanceUrl, 'instanceUrl')
  if (!urlValidation.isValid) {
    throw new Error(`Invalid Agiloft instance URL: ${urlValidation.error}`)
  }

  const kb = encodeURIComponent(params.knowledgeBase)
  const login = encodeURIComponent(params.login)
  const password = encodeURIComponent(params.password)

  const url = `${base}/ewws/EWLogin?$KB=${kb}&$login=${login}&$password=${password}`
  const response = await fetch(url, { method: 'POST' })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Agiloft login failed: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  const token = data.access_token

  if (!token) {
    throw new Error('Agiloft login did not return an access token')
  }

  return token
}

/**
 * Cleans up the server session. Best-effort — failures are logged but not thrown.
 */
async function agiloftLogout(
  instanceUrl: string,
  knowledgeBase: string,
  token: string
): Promise<void> {
  try {
    const base = instanceUrl.replace(/\/$/, '')
    const kb = encodeURIComponent(knowledgeBase)
    await fetch(`${base}/ewws/EWLogout?$KB=${kb}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (error) {
    logger.warn('Agiloft logout failed (best-effort)', { error })
  }
}

/**
 * Shared wrapper that handles the full auth lifecycle:
 * 1. Login to get Bearer token
 * 2. Execute the request with the token
 * 3. Logout to clean up the session
 *
 * The `buildRequest` callback receives the token and base URL, and returns
 * the request config. The `transformResponse` callback converts the raw
 * Response into the tool's output format.
 */
export async function executeAgiloftRequest<R extends ToolResponse>(
  params: AgiloftBaseParams,
  buildRequest: (base: string) => AgiloftRequestConfig,
  transformResponse: (response: Response) => Promise<R>
): Promise<R> {
  const token = await agiloftLogin(params)
  const base = params.instanceUrl.replace(/\/$/, '')

  try {
    const req = buildRequest(base)
    const response = await fetch(req.url, {
      method: req.method,
      headers: {
        ...req.headers,
        Authorization: `Bearer ${token}`,
      },
      body: req.body,
    })
    return await transformResponse(response)
  } finally {
    await agiloftLogout(params.instanceUrl, params.knowledgeBase, token)
  }
}

/**
 * Login helper exported for use in the attach file API route.
 */
export { agiloftLogin, agiloftLogout }

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
