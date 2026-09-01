/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chunkArray, interruptibleSleep, noop, sleep } from './helpers.js'

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

describe('interruptibleSleep', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves after the delay when no signal is provided', async () => {
    const promise = interruptibleSleep(1000)
    vi.advanceTimersByTime(1000)
    await expect(promise).resolves.toBeUndefined()
  })

  it('resolves after the delay when the signal never aborts', async () => {
    const controller = new AbortController()
    const promise = interruptibleSleep(1000, controller.signal)
    vi.advanceTimersByTime(1000)
    await expect(promise).resolves.toBeUndefined()
  })

  it('resolves early when the signal aborts mid-sleep', async () => {
    const controller = new AbortController()
    let resolved = false
    interruptibleSleep(60_000, controller.signal).then(() => {
      resolved = true
    })
    vi.advanceTimersByTime(1)
    controller.abort()
    await Promise.resolve()
    expect(resolved).toBe(true)
  })

  it('resolves immediately for an already-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(interruptibleSleep(60_000, controller.signal)).resolves.toBeUndefined()
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
