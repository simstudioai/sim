import { LRUCache } from 'lru-cache'
import { MAX_JSON_API_RESPONSE_BYTES } from '@/lib/core/security/input-validation.server'
import { consumeOrCancelBody, readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { extractVantaError } from '@/lib/internal/vanta/normalizers'
import type { VantaRegion } from '@/tools/vanta/types'

export const VANTA_API_BASE_URLS: Record<VantaRegion, string> = {
  us: 'https://api.vanta.com',
  gov: 'https://api.vanta-gov.com',
}

export const VANTA_READ_SCOPE = 'vanta-api.all:read'
export const VANTA_WRITE_SCOPE = 'vanta-api.all:read vanta-api.all:write'
export const VANTA_DOCUMENT_UPLOAD_SCOPE =
  'vanta-api.all:read vanta-api.all:write vanta-api.documents:upload'

const VANTA_TOKEN_EXPIRY_BUFFER_MS = 10 * 60 * 1000
const VANTA_TOKEN_EXCHANGE_TIMEOUT_MS = 15_000
const VANTA_TOKEN_CACHE_MAX_ENTRIES = 128
const VANTA_TOKEN_EXCHANGE_MAX_ENTRIES = 128

export interface VantaTokenParams {
  clientId: string
  clientSecret: string
  region?: VantaRegion
  scope: string
}

interface VantaCachedToken {
  token: string
  expiresAt: number
}

interface VantaTokenExchange {
  controller: AbortController
  promise: Promise<string>
  settled: boolean
  waiters: number
}

const vantaTokenCache = new LRUCache<string, VantaCachedToken>({
  max: VANTA_TOKEN_CACHE_MAX_ENTRIES,
})
const vantaTokenExchanges = new Map<string, VantaTokenExchange>()

export function getVantaBaseUrl(region: VantaRegion | undefined): string {
  return VANTA_API_BASE_URLS[region ?? 'us']
}

async function vantaTokenCacheKey(params: VantaTokenParams): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${params.clientId}:${params.clientSecret}`)
  )
  const secretHash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return [params.region ?? 'us', params.scope, params.clientId, secretHash].join('|')
}

async function exchangeVantaToken(
  params: VantaTokenParams,
  cacheKey: string,
  signal: AbortSignal
): Promise<string> {
  const requestSignal = AbortSignal.any([
    signal,
    AbortSignal.timeout(VANTA_TOKEN_EXCHANGE_TIMEOUT_MS),
  ])
  const response = await fetch(`${getVantaBaseUrl(params.region)}/oauth/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      scope: params.scope,
      grant_type: 'client_credentials',
    }),
    cache: 'no-store',
    signal: requestSignal,
  })

  const data = await readResponseJsonWithLimit<unknown>(response, {
    maxBytes: MAX_JSON_API_RESPONSE_BYTES,
    label: 'Vanta authentication response',
    signal: requestSignal,
  }).catch(() => null)
  if (!response.ok) {
    throw new Error(extractVantaError(data, 'Failed to authenticate with Vanta'))
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Vanta authentication did not return an access token')
  }
  const accessToken = Reflect.get(data, 'access_token')
  if (typeof accessToken !== 'string') {
    throw new Error('Vanta authentication did not return an access token')
  }

  const expiresIn = Reflect.get(data, 'expires_in')
  const expiresInMs =
    (typeof expiresIn === 'number' && Number.isFinite(expiresIn) ? expiresIn : 0) * 1000
  if (expiresInMs > VANTA_TOKEN_EXPIRY_BUFFER_MS) {
    vantaTokenCache.set(cacheKey, {
      token: accessToken,
      expiresAt: Date.now() + expiresInMs - VANTA_TOKEN_EXPIRY_BUFFER_MS,
    })
  }

  return accessToken
}

function waitForExchange(exchange: VantaTokenExchange, signal?: AbortSignal): Promise<string> {
  if (!signal) return exchange.promise
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      cleanup()
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    exchange.promise.then(
      (token) => {
        cleanup()
        resolve(token)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      }
    )
  })
}

function createVantaTokenExchange(params: VantaTokenParams, cacheKey: string): VantaTokenExchange {
  if (vantaTokenExchanges.size >= VANTA_TOKEN_EXCHANGE_MAX_ENTRIES) {
    throw new Error('Too many concurrent Vanta authentication requests')
  }
  const controller = new AbortController()
  const exchange: VantaTokenExchange = {
    controller,
    promise: Promise.resolve(''),
    settled: false,
    waiters: 0,
  }
  exchange.promise = exchangeVantaToken(params, cacheKey, controller.signal).finally(() => {
    exchange.settled = true
    if (vantaTokenExchanges.get(cacheKey) === exchange) {
      vantaTokenExchanges.delete(cacheKey)
    }
  })
  vantaTokenExchanges.set(cacheKey, exchange)
  return exchange
}

export async function getVantaAccessToken(
  params: VantaTokenParams,
  options: { forceRefresh?: boolean; signal?: AbortSignal } = {}
): Promise<string> {
  options.signal?.throwIfAborted()
  const cacheKey = await vantaTokenCacheKey(params)
  options.signal?.throwIfAborted()
  if (!options.forceRefresh) {
    const cached = vantaTokenCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.token
  }

  vantaTokenCache.delete(cacheKey)
  const exchange = vantaTokenExchanges.get(cacheKey) ?? createVantaTokenExchange(params, cacheKey)
  exchange.waiters += 1
  try {
    return await waitForExchange(exchange, options.signal)
  } finally {
    exchange.waiters -= 1
    if (exchange.waiters === 0 && !exchange.settled) {
      if (vantaTokenExchanges.get(cacheKey) === exchange) vantaTokenExchanges.delete(cacheKey)
      exchange.controller.abort(options.signal?.reason)
    }
  }
}

export async function fetchVantaWithAuth(
  tokenParams: VantaTokenParams,
  doFetch: (accessToken: string) => Promise<Response>,
  options: { signal?: AbortSignal } = {}
): Promise<Response> {
  options.signal?.throwIfAborted()
  const accessToken = await getVantaAccessToken(tokenParams, { signal: options.signal })
  options.signal?.throwIfAborted()
  const response = await doFetch(accessToken)
  options.signal?.throwIfAborted()
  if (response.status !== 401) return response
  await consumeOrCancelBody(response)
  options.signal?.throwIfAborted()

  const freshToken = await getVantaAccessToken(tokenParams, {
    forceRefresh: true,
    signal: options.signal,
  })
  options.signal?.throwIfAborted()
  return doFetch(freshToken)
}
