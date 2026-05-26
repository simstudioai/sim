const inflight = new Map<string, Promise<unknown>>()

export function coalesceLocally<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined
  if (existing) return existing

  const promise = (async () => {
    try {
      return await fn()
    } finally {
      inflight.delete(key)
    }
  })()

  inflight.set(key, promise)
  return promise
}

export function __resetCoalesceLocallyForTests(): void {
  inflight.clear()
}
