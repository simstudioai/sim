/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chunkArray, noop, sleep } from './helpers.js'

describe('sleep', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves after the specified delay', async () => {
    const promise = sleep(1000)
    vi.advanceTimersByTime(1000)
    await expect(promise).resolves.toBeUndefined()
  })

  it('does not resolve before the delay', async () => {
    let resolved = false
    sleep(1000).then(() => {
      resolved = true
    })
    vi.advanceTimersByTime(999)
    await Promise.resolve()
    expect(resolved).toBe(false)
  })
})

describe('noop', () => {
  it('is a function', () => {
    expect(typeof noop).toBe('function')
  })

  it('returns undefined', () => {
    expect(noop()).toBeUndefined()
  })
})

describe('chunkArray', () => {
  it('preserves order while bounding chunk size', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('rejects a non-positive chunk size', () => {
    expect(() => chunkArray([1], 0)).toThrow('positive integer')
  })
})
