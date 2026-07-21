export interface ReadinessOptions {
  name: string
  url: string
  timeoutMs?: number
  intervalMs?: number
  signal?: AbortSignal
  validate?: (response: Response) => Promise<boolean> | boolean
}

export async function waitForHttpReady({
  name,
  url,
  timeoutMs = 120_000,
  intervalMs = 500,
  signal,
  validate = (response) => response.ok,
}: ReadinessOptions): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown

  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason
    try {
      const timeoutSignal = AbortSignal.timeout(5_000)
      const response = await fetch(url, {
        redirect: 'manual',
        signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
      })
      if (await validate(response)) return
      lastError = new Error(`${name} returned ${response.status}`)
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      lastError = error
    }
    await waitForInterval(intervalMs, signal)
  }

  throw new Error(`${name} did not become ready at ${url}: ${String(lastError)}`)
}

async function waitForInterval(milliseconds: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const complete = () => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    const timeout = setTimeout(complete, milliseconds)
    const abort = () => {
      clearTimeout(timeout)
      reject(signal?.reason)
    }
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}
