import { createLogger } from '@sim/logger'
import { parseRetryAfter } from '@sim/utils/retry'
import {
  SelectorConnectionUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'

const logger = createLogger('SelectorProviderHttp')

const PROVIDER_TIMEOUT_MS = 30_000
const MAX_PROVIDER_RESPONSE_BYTES = 16 * 1024 * 1024

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {}
}

async function readBoundedBody(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_RESPONSE_BYTES) {
    await cancelResponseBody(response)
    throw new SelectorOptionsUnavailableError()
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_PROVIDER_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new SelectorOptionsUnavailableError()
    }
    chunks.push(value)
  }

  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

/**
 * Host and path of a provider request, with the parts that can carry user data removed: the query
 * string (tokens, filters), OData-style path arguments (`search(q='...')` holds search text), and
 * any segment holding an email address (a Google calendar id is usually its owner's address).
 */
function providerEndpoint(input: RequestInfo | URL): string | undefined {
  try {
    const url = new URL(input instanceof Request ? input.url : input)
    const path = url.pathname
      .replace(/\([^/]*\)/g, '()')
      .replace(/[^/]*(?:@|%40)[^/]*/gi, '{redacted}')
    return `${url.host}${path}`
  } catch {
    return undefined
  }
}

/**
 * Records why a provider call failed before the error is reduced to a bare status, the only
 * place the upstream status and endpoint are still known.
 */
function logProviderFailure(
  input: RequestInfo | URL,
  reason: 'status' | 'network' | 'invalid_response',
  status?: number
): void {
  logger.warn('Selector provider request failed', {
    endpoint: providerEndpoint(input),
    reason,
    ...(status !== undefined ? { status } : {}),
  })
}

export type ProviderJsonStatusResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; retryAfterMs?: number }

export interface FetchProviderJsonStatusOptions {
  passthroughStatuses?: readonly number[]
  passthroughStatus?: (status: number) => boolean
  /** Preserve a generic, retryable network signal without exposing the raw fetch error. */
  passthroughNetworkErrors?: boolean
}

export class RetryableProviderNetworkError extends Error {
  constructor() {
    super('Provider network unavailable')
    this.name = 'RetryableProviderNetworkError'
  }
}

export function selectorProviderStatusError(status: number): Error {
  if (status === 401) return new SelectorConnectionUnavailableError(401)
  if (status === 403) return new SelectorConnectionUnavailableError(403)
  if (status === 429) return new SelectorOptionsUnavailableError(429)
  return new SelectorOptionsUnavailableError(502)
}

/**
 * Fetches bounded provider JSON while allowing callers to branch on explicitly
 * allowlisted non-success statuses. Passthrough response bodies are discarded;
 * provider payloads never escape this boundary on an error status.
 */
export async function fetchProviderJsonWithStatus<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: FetchProviderJsonStatusOptions = {}
): Promise<ProviderJsonStatusResult<T>> {
  let response: Response
  const timeoutSignal = AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
  const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
  try {
    response = await fetch(input, { ...init, signal, redirect: init?.redirect ?? 'error' })
  } catch (error) {
    if (init?.signal?.aborted) throw error
    logProviderFailure(input, 'network')
    if (options.passthroughNetworkErrors) throw new RetryableProviderNetworkError()
    throw new SelectorOptionsUnavailableError()
  }

  if (!response.ok) {
    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
    await cancelResponseBody(response)
    if (
      options.passthroughStatuses?.includes(response.status) ||
      options.passthroughStatus?.(response.status)
    ) {
      return {
        ok: false,
        status: response.status,
        ...(retryAfterMs !== null && retryAfterMs > 0 ? { retryAfterMs } : {}),
      }
    }
    logProviderFailure(input, 'status', response.status)
    throw selectorProviderStatusError(response.status)
  }
  try {
    return {
      ok: true,
      status: response.status,
      data: JSON.parse(await readBoundedBody(response)) as T,
    }
  } catch (error) {
    if (init?.signal?.aborted) throw error
    logProviderFailure(
      input,
      error instanceof SyntaxError || error instanceof SelectorOptionsUnavailableError
        ? 'invalid_response'
        : 'network',
      response.status
    )
    if (error instanceof SelectorOptionsUnavailableError) throw error
    throw new SelectorOptionsUnavailableError()
  }
}

export async function fetchProviderJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  const result = await fetchProviderJsonWithStatus<T>(input, init)
  if (!result.ok) throw new SelectorOptionsUnavailableError()
  return result.data
}
