import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLookup } = vi.hoisted(() => ({ mockLookup: vi.fn() }))

vi.mock('node:dns/promises', () => ({
  default: { lookup: mockLookup },
}))

import { DnsTimeoutError, resolveHostAddresses } from './dns'

describe('resolveHostAddresses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns every address, not just the one worth pinning', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ])

    const resolved = await resolveHostAddresses('mixed.example')

    expect(resolved.addresses).toEqual(['93.184.216.34', '10.0.0.5'])
  })

  it('prefers IPv4 for the pinnable address', async () => {
    mockLookup.mockResolvedValue([
      { address: '2606:2800:220:1::248', family: 6 },
      { address: '93.184.216.34', family: 4 },
    ])

    const resolved = await resolveHostAddresses('dual.example')

    expect(resolved.preferred).toBe('93.184.216.34')
    expect(resolved.addresses).toHaveLength(2)
  })

  it('falls back to the first address when there is no IPv4 record', async () => {
    mockLookup.mockResolvedValue([{ address: '2606:2800:220:1::248', family: 6 }])

    const resolved = await resolveHostAddresses('v6only.example')

    expect(resolved.preferred).toBe('2606:2800:220:1::248')
  })

  it('rejects rather than returning nothing when the resolver answers empty', async () => {
    mockLookup.mockResolvedValue([])

    await expect(resolveHostAddresses('empty.example')).rejects.toThrow('No addresses')
  })

  it('rejects when the resolver fails', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'))

    await expect(resolveHostAddresses('missing.example')).rejects.toThrow('ENOTFOUND')
  })

  it('clears the deadline timer once the lookup succeeds', async () => {
    // A leaked timer holds the event loop open for the full window and is
    // invisible to every other assertion here.
    vi.useFakeTimers()
    try {
      mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])

      await resolveHostAddresses('example.com')

      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('swallows a lookup that rejects after the deadline already fired', async () => {
    // Without the pre-race `.catch`, the loser of the race surfaces as an
    // unhandled rejection well after the caller has moved on.
    vi.useFakeTimers()
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      let failLookup: (error: Error) => void = () => {}
      mockLookup.mockReturnValue(
        new Promise((_resolve, reject) => {
          failLookup = reject
        })
      )

      const pending = resolveHostAddresses('slow.example', { timeoutMs: 1_000 })
      const assertion = expect(pending).rejects.toThrow('timed out')
      await vi.advanceTimersByTimeAsync(1_000)
      await assertion

      failLookup(new Error('ENOTFOUND'))
      await vi.advanceTimersByTimeAsync(0)
      await Promise.resolve()

      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
      vi.useRealTimers()
    }
  })

  it('rejects on the deadline instead of waiting for a hung resolver', async () => {
    vi.useFakeTimers()
    try {
      mockLookup.mockReturnValue(new Promise(() => {}))

      const pending = resolveHostAddresses('slow.example', { timeoutMs: 1_000 })
      const assertion = expect(pending).rejects.toThrow('timed out')
      await vi.advanceTimersByTimeAsync(1_000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports a deadline distinctly from a missing host', async () => {
    vi.useFakeTimers()
    try {
      mockLookup.mockReturnValue(new Promise(() => {}))

      const pending = resolveHostAddresses('slow.example', { timeoutMs: 1_000 })
      const assertion = expect(pending).rejects.toBeInstanceOf(DnsTimeoutError)
      await vi.advanceTimersByTimeAsync(1_000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })
})
