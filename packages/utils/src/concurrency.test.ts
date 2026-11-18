import { describe, expect, it } from 'vitest'
import { mapWithConcurrency } from './concurrency.js'

/** A promise resolved from outside, to hold an item in flight until the test releases it. */
function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('mapWithConcurrency', () => {
  it('never runs more than the limit at once, and frees a slot as soon as one item settles', async () => {
    const gates = [deferred(), deferred(), deferred(), deferred()]
    const started: number[] = []
    const run = mapWithConcurrency([0, 1, 2, 3], 2, async (item) => {
      started.push(item)
      await gates[item].promise
      return item * 10
    })
    await Promise.resolve()
    expect(started).toEqual([0, 1])

    gates[1].resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(started).toEqual([0, 1, 2])

    for (const gate of gates) gate.resolve()
    await expect(run).resolves.toEqual([0, 10, 20, 30])
  })

  it('starts nothing after a failure, and throws it only once the running items settle', async () => {
    const slow = deferred()
    const started: number[] = []
    let slowSettled = false
    const run = mapWithConcurrency([0, 1, 2, 3], 2, async (item) => {
      started.push(item)
      if (item === 0) throw new Error('first failed')
      await slow.promise
      slowSettled = true
    })
    let rejected = false
    run.catch(() => {
      rejected = true
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(rejected).toBe(false)

    slow.resolve()
    await expect(run).rejects.toThrow('first failed')
    expect(slowSettled).toBe(true)
    expect(started).toEqual([0, 1])
  })

  it('rejects a limit below one instead of running nothing', async () => {
    await expect(mapWithConcurrency([1], 0, async (item) => item)).rejects.toThrow(
      'positive integer'
    )
  })
})
