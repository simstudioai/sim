import { SelectorOptionsUnavailableError } from '@/lib/selectors/server/errors'

const PROVIDER_TIMEOUT_MS = 30_000
const MAX_PROVIDER_RESPONSE_BYTES = 16 * 1024 * 1024

async function readBoundedBody(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_RESPONSE_BYTES) {
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
      await reader.cancel()
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

export async function fetchProviderJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  let response: Response
  const timeoutSignal = AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
  const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
  try {
    response = await fetch(input, { ...init, signal, redirect: init?.redirect ?? 'error' })
  } catch (error) {
    if (init?.signal?.aborted) throw error
    throw new SelectorOptionsUnavailableError()
  }

  if (!response.ok) throw new SelectorOptionsUnavailableError()
  try {
    return JSON.parse(await readBoundedBody(response)) as T
  } catch (error) {
    if (init?.signal?.aborted) throw error
    if (error instanceof SelectorOptionsUnavailableError) throw error
    throw new SelectorOptionsUnavailableError()
  }
}
