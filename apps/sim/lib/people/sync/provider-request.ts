import { parseRetryAfter } from '@sim/utils/retry'
import { isRetryableInfrastructureError } from '@/lib/core/errors/retryable-infrastructure'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type SecureFetchOptions,
  secureFetchWithValidation,
} from '@/lib/core/security/input-validation.server'

const MAX_PAGE_BYTES = 2 * 1024 * 1024
export const MAX_NEXT_LINK_LENGTH = 8192

function collectionPath(url: URL) {
  if (url.origin !== 'https://graph.microsoft.com') return url.pathname
  return url.pathname
    .replace(/^\/v1\.0\/users(?=\/|$)/i, '/v1.0/users')
    .replace(/\/directreports$/i, '/directReports')
}

export function checkedDirectoryNextLink(href: string, endpoint: URL): URL {
  const url = href.length <= MAX_NEXT_LINK_LENGTH && URL.canParse(href) ? new URL(href) : null
  if (
    !url ||
    url.origin !== endpoint.origin ||
    collectionPath(url) !== collectionPath(endpoint) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new OrchestrationError('validation', 'The directory returned an invalid pagination link.')
  }
  return url
}

const DEFAULT_RETRY_MS = 60_000
const MAX_RETRY_MS = 365 * 24 * 60 * 60_000

export class DirectoryRetryError extends OrchestrationError {
  constructor(
    message: string,
    readonly retryAfterMs: number
  ) {
    super('validation', message)
    this.name = 'DirectoryRetryError'
  }
}

type HeaderReader = { get(name: string): string | null }

/** Graph may throttle individual operations inside an otherwise successful batch. Okta uses a UTC reset epoch. */
export function directoryRetryDelay(status: number, headers?: HeaderReader): number | null {
  if (status !== 408 && status !== 429 && !(status >= 500 && status <= 599)) return null
  const retry = parseRetryAfter(headers?.get('retry-after') ?? null, MAX_RETRY_MS)
  if (retry !== null) return Math.max(1000, retry)
  if (status === 429) {
    const serverDate = Date.parse(headers?.get('date') ?? '')
    const reset =
      Number(headers?.get('x-rate-limit-reset')) * 1000 -
      (Number.isFinite(serverDate) ? serverDate : Date.now())
    if (reset > 0 && reset <= MAX_RETRY_MS) return Math.ceil(reset)
  }
  return DEFAULT_RETRY_MS
}

export function requireDirectorySuccess(status: number, headers?: HeaderReader): void {
  if (status === 200) return
  const retryAfterMs = directoryRetryDelay(status, headers)
  if (retryAfterMs !== null) {
    throw new DirectoryRetryError(
      status === 429
        ? 'The directory rate limit was reached. Try again later.'
        : 'The directory is temporarily unavailable. Try again later.',
      retryAfterMs
    )
  }
  if (status === 401 || status === 403)
    throw new OrchestrationError(
      'validation',
      'The directory refused access. Check your credentials and directory permissions.'
    )
  throw new OrchestrationError(
    'validation',
    `The directory returned HTTP ${status}. Try again later.`
  )
}

/** All directory egress is pinned, bounded and free of provider-supplied error text. */
export async function readDirectoryResponse(
  url: URL,
  options: Pick<SecureFetchOptions, 'method' | 'headers' | 'body' | 'signal'>,
  tokenExchange = false
) {
  const signal = options.signal ?? AbortSignal.timeout(15_000)
  const response = await secureFetchWithValidation(url.href, {
    ...options,
    signal,
    profile: 'contentFetch',
    maxRedirects: 0,
    maxResponseBytes: tokenExchange ? 64 * 1024 : MAX_PAGE_BYTES,
    timeout: 15_000,
    acceptCompressed: true,
    logUrlValidationDetails: false,
  }).catch((error: unknown) => {
    if (
      isRetryableInfrastructureError(error) ||
      signal.aborted ||
      (error instanceof TypeError && error.message === 'fetch failed')
    ) {
      throw new DirectoryRetryError(
        'Could not reach the directory. Try again later.',
        DEFAULT_RETRY_MS
      )
    }
    throw new OrchestrationError(
      'validation',
      'Could not read the directory. Check the directory address, network access, and response size.'
    )
  })
  if (response.status !== 200) await response.body?.cancel().catch(() => undefined)
  if (tokenExchange && [400, 401, 403].includes(response.status))
    throw new OrchestrationError(
      'validation',
      'Microsoft refused the application credentials. Check the tenant ID, application ID, and client secret.'
    )
  requireDirectorySuccess(response.status, response.headers)
  const data: unknown = await response.json().catch((error: unknown) => {
    if (isRetryableInfrastructureError(error) || signal.aborted)
      throw new DirectoryRetryError(
        'The directory response was interrupted. Try again later.',
        DEFAULT_RETRY_MS
      )
    throw new OrchestrationError('validation', 'The directory returned an unreadable page.')
  })
  return { data, link: response.headers.get('link') }
}
