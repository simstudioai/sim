import { describe, expect, it } from 'vitest'
import {
  isPreviewSessionPastHardMax,
  mintPreviewChannelNonce,
  PREVIEW_SESSION_HARD_MAX_MS,
} from '@/lib/apps/preview-ttl'
import { safeJsonForScript } from '@/lib/apps/safe-json'

describe('preview security helpers', () => {
  it('mints high-entropy channel nonces', () => {
    const a = mintPreviewChannelNonce()
    const b = mintPreviewChannelNonce()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(32)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('safeJsonForScript blocks script breakout', () => {
    const injected = safeJsonForScript({
      channelNonce: 'x',
      parentOrigin: 'https://evil.test/</script><script>alert(1)</script>',
    })
    expect(injected).not.toContain('</script>')
    expect(injected).toContain('\\u003c')
  })

  it('enforces the 24h hard maximum', () => {
    const started = new Date(Date.now() - PREVIEW_SESSION_HARD_MAX_MS - 1)
    expect(isPreviewSessionPastHardMax(started)).toBe(true)
    expect(isPreviewSessionPastHardMax(new Date())).toBe(false)
  })
})
