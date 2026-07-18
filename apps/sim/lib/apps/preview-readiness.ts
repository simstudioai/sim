const DEFAULT_ATTEMPTS = 6
const DEFAULT_REQUEST_TIMEOUT_MS = 1_500
const DEFAULT_INITIAL_DELAY_MS = 150

export type PreviewReadinessResult =
  | { ok: true; attempts: number }
  | { ok: false; attempts: number; lastStatus?: number }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Probe the exact Apps Host preview document before exposing its URL to the browser.
 * This verifies the host, Sim callback, session metadata, and artifact in one request.
 */
export async function waitForAppPreviewReady(params: {
  previewUrl: string
  abortSignal?: AbortSignal
  attempts?: number
  requestTimeoutMs?: number
  initialDelayMs?: number
  fetcher?: typeof fetch
  sleeper?: (ms: number) => Promise<void>
}): Promise<PreviewReadinessResult> {
  const attempts = Math.max(1, params.attempts ?? DEFAULT_ATTEMPTS)
  const requestTimeoutMs = Math.max(1, params.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)
  const initialDelayMs = Math.max(0, params.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS)
  const fetcher = params.fetcher ?? fetch
  const wait = params.sleeper ?? sleep
  let lastStatus: number | undefined

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (params.abortSignal?.aborted) {
      return { ok: false, attempts: attempt - 1, lastStatus }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
    const onAbort = () => controller.abort()
    params.abortSignal?.addEventListener('abort', onAbort, { once: true })

    try {
      const response = await fetcher(params.previewUrl, {
        method: 'GET',
        headers: { accept: 'text/html' },
        cache: 'no-store',
        signal: controller.signal,
      })
      lastStatus = response.status
      if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
        return { ok: true, attempts: attempt }
      }
      // These are configuration/capability failures, not startup races.
      if (response.status === 400 || response.status === 404 || response.status === 410) {
        return { ok: false, attempts: attempt, lastStatus }
      }
    } catch {
      // Connection refused/timeouts are expected while Apps Host is starting.
    } finally {
      clearTimeout(timeout)
      params.abortSignal?.removeEventListener('abort', onAbort)
    }

    if (attempt < attempts) {
      const delay = Math.min(initialDelayMs * 2 ** (attempt - 1), 2_000)
      await wait(delay)
    }
  }

  return { ok: false, attempts, lastStatus }
}
