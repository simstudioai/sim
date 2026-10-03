/**
 * Awaits `ticks` microtask turns, letting already-settled promise chains run
 * (fire-and-forget `.then` continuations, a chain of `await`s) without
 * advancing timers. Safe under `vi.useFakeTimers()`.
 *
 * @example
 * ```ts
 * startDetachedWork()
 * await flushMicrotasks(3)
 * expect(mockSave).toHaveBeenCalled()
 * ```
 */
export async function flushMicrotasks(ticks = 1): Promise<void> {
  for (let i = 0; i < ticks; i++) await Promise.resolve()
}

/**
 * Yields one macrotask turn (`setTimeout(0)`), which drains every pending
 * microtask plus I/O-free callbacks queued before it. Use when the code under
 * test schedules work with a timer or crosses an unknown number of `await`s.
 * Never call it while fake timers are installed: it waits on a real timer.
 * Deliberately not `sleep` from `@sim/utils/helpers`: tests mock that module, and a
 * helper that imports a mocked module breaks their hoisted factories.
 *
 * @example
 * ```ts
 * void route.POST(request)
 * await flushMacrotask()
 * ```
 */
export async function flushMacrotask(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

/**
 * Reads a `ReadableStream` to the end and returns every chunk in order.
 *
 * @example
 * ```ts
 * const events = await collectStream(result.stream)
 * expect(events.map((event) => event.type)).toEqual(['text', 'done'])
 * ```
 */
export async function collectStream<T>(stream: ReadableStream<T>): Promise<T[]> {
  const chunks: T[] = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  return chunks
}
