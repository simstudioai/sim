import { flushMacrotask } from '@sim/testing/helpers/async'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { describe, expect, it } from 'vitest'
import { createConcurrencyLimit } from '@/lib/core/utils/concurrency'

describe('createConcurrencyLimit', () => {
  it('runs at most the limit at once and starts waiting tasks in call order', async () => {
    const limit = createConcurrencyLimit(2)
    const gates = Array.from({ length: 5 }, () => createDeferred<void>())
    const started: number[] = []
    let active = 0
    let peak = 0
    const runs = gates.map((gate, index) =>
      limit(async () => {
        started.push(index)
        peak = Math.max(peak, ++active)
        await gate.promise
        active--
        return index
      })
    )
    await flushMacrotask()
    expect(started).toEqual([0, 1])
    for (const index of [1, 0, 4, 3, 2]) {
      gates[index].resolve()
      await flushMacrotask()
    }
    await expect(Promise.all(runs)).resolves.toEqual([0, 1, 2, 3, 4])
    expect(started).toEqual([0, 1, 2, 3, 4])
    expect(peak).toBe(2)
  })

  it('releases the slot of a task that throws synchronously or rejects', async () => {
    const limit = createConcurrencyLimit(1)
    const error = new Error('task failed')
    const throwsSynchronously = (): Promise<never> => {
      throw error
    }
    const thrown = limit(throwsSynchronously)
    const rejected = limit(async () => Promise.reject(error))
    let next: string | undefined
    void limit(async () => 'next').then((value) => {
      next = value
    })
    await expect(thrown).rejects.toBe(error)
    await expect(rejected).rejects.toBe(error)
    await flushMacrotask()
    expect(next).toBe('next')
  })
})
