import { describe, expect, it } from 'vitest'
import {
  mapEachWithConcurrency,
  mapSettledWithConcurrency,
  mapWithConcurrency,
} from './concurrency.js'

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

  it('throws the failure that happened first, not the one in the lowest slot', async () => {
    const slowFailure = deferred()
    const run = mapWithConcurrency([0, 1], 2, async (item) => {
      if (item === 0) {
        await slowFailure.promise
        throw new Error('later failure')
      }
      throw new Error('earlier failure')
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    slowFailure.resolve()
    await expect(run).rejects.toThrow('earlier failure')
  })

  it('rejects a limit below one instead of running nothing', async () => {
    await expect(mapWithConcurrency([1], 0, async (item) => item)).rejects.toThrow(
      'positive integer'
    )
  })
})

describe('mapSettledWithConcurrency', () => {
  it('attempts every item after a failure and reports each outcome in input order', async () => {
    const started: number[] = []
    const failure = new Error('one failed')
    const outcomes = await mapSettledWithConcurrency([0, 1, 2, 3], 2, async (item) => {
      started.push(item)
      if (item === 1) throw failure
      return item * 10
    })
    expect([...started].sort()).toEqual([0, 1, 2, 3])
    expect(outcomes).toEqual([
      { status: 'fulfilled', value: 0 },
      { status: 'rejected', reason: failure },
      { status: 'fulfilled', value: 20 },
      { status: 'fulfilled', value: 30 },
    ])
  })
})

describe('mapEachWithConcurrency', () => {
  it('attempts every item after a failure, then throws the first failure', async () => {
    const attempted: number[] = []
    const run = mapEachWithConcurrency([0, 1, 2, 3, 4], 2, async (item) => {
      attempted.push(item)
      if (item === 0) throw new Error('first item failed')
      if (item === 3) throw new Error('later item failed')
      return item
    })
    await expect(run).rejects.toThrow('first item failed')
    expect([...attempted].sort()).toEqual([0, 1, 2, 3, 4])
  })

  it('returns every result in input order when nothing fails', async () => {
    await expect(mapEachWithConcurrency([3, 1, 2], 2, async (item) => item * 10)).resolves.toEqual([
      30, 10, 20,
    ])
  })
})
