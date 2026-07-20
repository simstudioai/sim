export interface ReadinessOptions {
  name: string
  url: string
  timeoutMs?: number
  intervalMs?: number
  validate?: (response: Response) => Promise<boolean> | boolean
}

export async function waitForHttpReady({
  name,
  url,
  timeoutMs = 120_000,
  intervalMs = 500,
  validate = (response) => response.ok,
}: ReadinessOptions): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5_000) })
      if (await validate(response)) return
      lastError = new Error(`${name} returned ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(`${name} did not become ready at ${url}: ${String(lastError)}`)
}
