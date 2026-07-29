import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLookup } = vi.hoisted(() => ({ mockLookup: vi.fn() }))

vi.mock('node:dns/promises', () => ({
  default: { lookup: mockLookup },
}))

import { resolveHostAddresses } from './dns'

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
})
