import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLookup } = vi.hoisted(() => ({ mockLookup: vi.fn() }))

vi.mock('node:dns/promises', () => ({
  default: { lookup: mockLookup },
}))

import { checkAgentUrl, isBlockedRequestUrl } from '@/main/browser-agent/url-guard'

describe('checkAgentUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  })

  it('rejects non-http(s) schemes without resolving', async () => {
    const result = await checkAgentUrl('file:///etc/passwd')
    expect(result.ok).toBe(false)
    expect(mockLookup).not.toHaveBeenCalled()
  })

  it('rejects malformed URLs', async () => {
    expect((await checkAgentUrl('not a url')).ok).toBe(false)
  })

  it('blocks private IP literals without resolving', async () => {
    expect((await checkAgentUrl('http://169.254.169.254/latest/meta-data')).ok).toBe(false)
    expect((await checkAgentUrl('http://10.0.0.5/')).ok).toBe(false)
    expect((await checkAgentUrl('http://192.168.1.1/')).ok).toBe(false)
    expect((await checkAgentUrl('http://[fd00::1]/')).ok).toBe(false)
    expect(mockLookup).not.toHaveBeenCalled()
  })

  it('allows loopback, so a local dev server can be opened', async () => {
    // The panel exists to browse from this machine, and the agent already has
    // an unrestricted shell on it. The LAN and the metadata endpoint above are
    // a different matter and stay blocked.
    expect((await checkAgentUrl('http://127.0.0.1:3000/')).ok).toBe(true)
    expect((await checkAgentUrl('http://[::1]:3000/')).ok).toBe(true)
    expect(mockLookup).not.toHaveBeenCalled()
  })

  it('allows localhost, which resolves to loopback', async () => {
    mockLookup.mockResolvedValue([
      { address: '::1', family: 6 },
      { address: '127.0.0.1', family: 4 },
    ])
    expect((await checkAgentUrl('http://localhost:3000/app')).ok).toBe(true)
  })

  it('still blocks a host that resolves to the LAN alongside loopback', async () => {
    mockLookup.mockResolvedValue([
      { address: '127.0.0.1', family: 4 },
      { address: '192.168.0.9', family: 4 },
    ])
    expect((await checkAgentUrl('http://sneaky.test/')).ok).toBe(false)
  })

  it('allows public IP literals without resolving', async () => {
    expect((await checkAgentUrl('https://8.8.8.8/')).ok).toBe(true)
    expect(mockLookup).not.toHaveBeenCalled()
  })

  it('allows hostnames that resolve to public addresses', async () => {
    const result = await checkAgentUrl('https://example.com/page')
    expect(result.ok).toBe(true)
    expect(mockLookup).toHaveBeenCalledWith('example.com', { all: true, verbatim: true })
  })

  it('blocks hostnames that resolve to a private address (DNS rebinding)', async () => {
    mockLookup.mockResolvedValue([{ address: '10.1.2.3', family: 4 }])
    expect((await checkAgentUrl('https://rebind.evil.test/')).ok).toBe(false)
  })

  it('blocks when any resolved address is private', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '192.168.0.9', family: 4 },
    ])
    expect((await checkAgentUrl('https://mixed.test/')).ok).toBe(false)
  })

  it('fails closed when DNS resolution fails', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'))
    expect((await checkAgentUrl('https://nope.invalid/')).ok).toBe(false)
  })

  it('fails closed when the DNS lookup exceeds the deadline', async () => {
    vi.useFakeTimers()
    try {
      mockLookup.mockReturnValue(new Promise(() => {})) // never resolves
      const pending = checkAgentUrl('https://slow.test/')
      await vi.advanceTimersByTimeAsync(5_000)
      expect((await pending).ok).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('isBlockedRequestUrl', () => {
  it('blocks literal private/reserved hosts', () => {
    expect(isBlockedRequestUrl('http://169.254.169.254/latest/meta-data')).toBe(true)
    expect(isBlockedRequestUrl('http://10.0.0.5/x')).toBe(true)
    expect(isBlockedRequestUrl('https://[fd00::1]/')).toBe(true)
  })

  it('allows loopback subresources, so a local page can load its own assets', () => {
    expect(isBlockedRequestUrl('http://127.0.0.1:8080/app.js')).toBe(false)
    expect(isBlockedRequestUrl('http://[::1]:8080/app.css')).toBe(false)
  })

  it('allows public literals and hostnames (classified at nav time)', () => {
    expect(isBlockedRequestUrl('https://8.8.8.8/')).toBe(false)
    expect(isBlockedRequestUrl('https://example.com/x')).toBe(false)
  })

  it('does not throw on malformed input', () => {
    expect(isBlockedRequestUrl('::::')).toBe(false)
  })
})
