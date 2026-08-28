import { SelectorOptionsUnavailableError } from '@/lib/selectors/server/errors'

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

export type ProviderJsonStatusResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number }

export interface FetchProviderJsonStatusOptions {
  passthroughStatuses?: readonly number[]
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
    throw new SelectorOptionsUnavailableError()
  }

  if (!response.ok) {
    await cancelResponseBody(response)
    if (options.passthroughStatuses?.includes(response.status)) {
      return { ok: false, status: response.status }
    }
    throw new SelectorOptionsUnavailableError()
  }
  try {
    return {
      ok: true,
      status: response.status,
      data: JSON.parse(await readBoundedBody(response)) as T,
    }
  } catch (error) {
    if (init?.signal?.aborted) throw error
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
