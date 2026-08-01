import { describe, expect, it } from 'vitest'
import { shouldBlockRequest } from '@/main/telemetry-policy'

describe('shouldBlockRequest', () => {
  it('blocks third-party analytics hosts and their subdomains', () => {
    expect(shouldBlockRequest('https://www.googletagmanager.com/gtm.js?id=GTM-X')).toBe(true)
    expect(shouldBlockRequest('https://google-analytics.com/collect')).toBe(true)
    expect(shouldBlockRequest('https://region1.google-analytics.com/g/collect')).toBe(true)
    expect(shouldBlockRequest('https://analytics.google.com/g/collect')).toBe(true)
    expect(shouldBlockRequest('https://stats.g.doubleclick.net/j/collect')).toBe(true)
  })

  it('leaves first-party and functional traffic alone', () => {
    expect(shouldBlockRequest('https://sim.ai/api/workflows')).toBe(false)
    expect(shouldBlockRequest('https://sim.ai/ingest/e')).toBe(false)
    expect(shouldBlockRequest('wss://api.elevenlabs.io/v1/stt')).toBe(false)
    expect(shouldBlockRequest('https://storage.googleapis.com/bucket/file')).toBe(false)
  })

  it('ignores unparseable URLs', () => {
    expect(shouldBlockRequest('not a url')).toBe(false)
  })
})
