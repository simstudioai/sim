import { createHash } from 'node:crypto'
import {
  MAX_JSON_API_RESPONSE_BYTES,
  type SecureFetchResponse,
  secureFetchWithValidation,
} from '@/lib/core/security/input-validation.server'
import {
  assertSafeSapExternalUrl,
  type SapS4HanaOperationInput,
} from '@/lib/internal/sap-s4hana/schema'

interface CachedToken {
  accessToken: string
  expiresAt: number
}

export interface SapCsrfBundle {
  token: string
  cookie: string
}

export interface SapOdataInvocation {
  status: number
  body: unknown
  csrfHeader: string
}

const TOKEN_CACHE = new Map<string, CachedToken>()
const TOKEN_CACHE_MAX_ENTRIES = 500
const TOKEN_SAFETY_WINDOW_MS = 60_000
const OUTBOUND_FETCH_TIMEOUT_MS = 30_000

function resolveTokenUrl(input: SapS4HanaOperationInput): string {
  if (input.deploymentType === 'cloud_public') {
    return `https://${input.subdomain}.authentication.${input.region}.hana.ondemand.com/oauth/token`
  }
  if (!input.tokenUrl) {
    throw new Error('tokenUrl is required for OAuth on cloud_private/on_premise')
  }
  return input.tokenUrl
}

function tokenCacheKey(input: SapS4HanaOperationInput): string {
  const secretHash = input.clientSecret
    ? createHash('sha256').update(input.clientSecret).digest('hex').slice(0, 16)
    : ''
  return `${resolveTokenUrl(input)}::${input.clientId ?? ''}::${secretHash}`
}

function rememberToken(key: string, token: CachedToken): void {
  if (TOKEN_CACHE.has(key)) TOKEN_CACHE.delete(key)
  TOKEN_CACHE.set(key, token)
  while (TOKEN_CACHE.size > TOKEN_CACHE_MAX_ENTRIES) {
    const oldestKey = TOKEN_CACHE.keys().next().value
    if (oldestKey === undefined) break
    TOKEN_CACHE.delete(oldestKey)
  }
}

export async function fetchSapAccessToken(
  input: SapS4HanaOperationInput,
  signal?: AbortSignal
): Promise<string> {
  signal?.throwIfAborted()
  const cacheKey = tokenCacheKey(input)
  const cached = TOKEN_CACHE.get(cacheKey)
  if (cached && cached.expiresAt - TOKEN_SAFETY_WINDOW_MS > Date.now()) {
    return cached.accessToken
  }

  const tokenUrl = assertSafeSapExternalUrl(resolveTokenUrl(input), 'tokenUrl').toString()
  const basic = Buffer.from(`${input.clientId}:${input.clientSecret}`).toString('base64')
  const response = await secureFetchWithValidation(
    tokenUrl,
    {
      profile: 'configuredEndpoint',
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
      timeout: OUTBOUND_FETCH_TIMEOUT_MS,
      maxResponseBytes: MAX_JSON_API_RESPONSE_BYTES,
      signal,
    },
    'tokenUrl'
  )
  signal?.throwIfAborted()

  if (!response.ok) {
    await response.text().catch(() => '')
    throw new Error(`SAP token request failed: HTTP ${response.status}`)
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number }
  signal?.throwIfAborted()
  if (!data.access_token) {
    throw new Error('SAP token response missing access_token')
  }

  rememberToken(cacheKey, {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  })
  return data.access_token
}

function joinSetCookies(response: SecureFetchResponse): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ')
}

function buildAuthHeader(input: SapS4HanaOperationInput, accessToken: string | null): string {
  if (input.authType === 'basic') {
    return `Basic ${Buffer.from(`${input.username}:${input.password}`).toString('base64')}`
  }
  return `Bearer ${accessToken}`
}

function resolveHost(input: SapS4HanaOperationInput): string {
  if (input.deploymentType === 'cloud_public') {
    const constructed = `https://${input.subdomain}-api.s4hana.ondemand.com`
    return assertSafeSapExternalUrl(constructed, 'subdomain').toString().replace(/\/+$/, '')
  }
  if (!input.baseUrl) {
    throw new Error('baseUrl is required for cloud_private and on_premise deployments')
  }
  return assertSafeSapExternalUrl(input.baseUrl.replace(/\/+$/, ''), 'baseUrl')
    .toString()
    .replace(/\/+$/, '')
}

function buildOdataUrl(input: SapS4HanaOperationInput, pathOverride?: string): string {
  const host = resolveHost(input)
  const servicePath = `/sap/opu/odata/sap/${input.service}`
  const subPath = pathOverride ?? input.path
  const normalized = subPath.startsWith('/') ? subPath : `/${subPath}`
  const base = `${host}${servicePath}${normalized}`
  if (pathOverride !== undefined || !input.query || Object.keys(input.query).length === 0) {
    return base
  }

  const encode = (value: string) => encodeURIComponent(value).replace(/%24/g, '$')
  const parts: string[] = []
  for (const [key, value] of Object.entries(input.query)) {
    if (value === undefined || value === null) continue
    parts.push(`${encode(key)}=${encode(String(value))}`)
  }
  const queryString = parts.join('&')
  if (!queryString) return base
  return base.includes('?') ? `${base}&${queryString}` : `${base}?${queryString}`
}

export async function fetchSapCsrf(
  input: SapS4HanaOperationInput,
  accessToken: string | null,
  signal?: AbortSignal
): Promise<SapCsrfBundle | null> {
  signal?.throwIfAborted()
  const response = await secureFetchWithValidation(
    buildOdataUrl(input, '/$metadata'),
    {
      profile: 'configuredEndpoint',
      method: 'GET',
      headers: {
        Authorization: buildAuthHeader(input, accessToken),
        Accept: 'application/xml',
        'X-CSRF-Token': 'Fetch',
      },
      timeout: OUTBOUND_FETCH_TIMEOUT_MS,
      maxResponseBytes: MAX_JSON_API_RESPONSE_BYTES,
      signal,
    },
    'baseUrl'
  )
  signal?.throwIfAborted()
  if (!response.ok) {
    await response.text().catch(() => '')
    return null
  }

  const token = response.headers.get('x-csrf-token')
  if (!token) return null
  return { token, cookie: joinSetCookies(response) }
}

export async function callSapOdata(
  input: SapS4HanaOperationInput,
  accessToken: string | null,
  csrf: SapCsrfBundle | null,
  signal?: AbortSignal
): Promise<SapOdataInvocation> {
  signal?.throwIfAborted()
  const headers: Record<string, string> = {
    Authorization: buildAuthHeader(input, accessToken),
    Accept: 'application/json',
  }
  const isWrite = isSapWriteMethod(input.method)
  const hasBody = input.body !== undefined && input.body !== null
  if (hasBody) headers['Content-Type'] = 'application/json'
  if (input.ifMatch) headers['If-Match'] = input.ifMatch
  if (isWrite && csrf) {
    headers['X-CSRF-Token'] = csrf.token
    if (csrf.cookie) headers.Cookie = csrf.cookie
  }

  const response = await secureFetchWithValidation(
    buildOdataUrl(input),
    {
      profile: 'configuredEndpoint',
      method: input.method,
      headers,
      body: hasBody ? JSON.stringify(input.body) : undefined,
      timeout: OUTBOUND_FETCH_TIMEOUT_MS,
      maxResponseBytes: MAX_JSON_API_RESPONSE_BYTES,
      signal,
    },
    'baseUrl'
  )
  signal?.throwIfAborted()

  const raw = await response.text()
  signal?.throwIfAborted()
  let body: unknown = null
  if (raw.length > 0) {
    try {
      body = JSON.parse(raw)
    } catch {
      body = raw
    }
  }

  return {
    status: response.status,
    body,
    csrfHeader: response.headers.get('x-csrf-token')?.toLowerCase() ?? '',
  }
}

export function isSapWriteMethod(method: SapS4HanaOperationInput['method']): boolean {
  return (
    method === 'POST' ||
    method === 'PUT' ||
    method === 'PATCH' ||
    method === 'DELETE' ||
    method === 'MERGE'
  )
}
