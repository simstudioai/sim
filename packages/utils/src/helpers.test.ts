import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chunkArray, interruptibleSleep } from './helpers.js'

describe('interruptibleSleep', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
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
})

describe('chunkArray', () => {
  it('rejects a non-positive chunk size', () => {
    expect(() => chunkArray([1], 0)).toThrow('positive integer')
  })
})
