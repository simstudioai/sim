import { describe, expect, it, vi } from 'vitest'

const SECRET = 'h'.repeat(32)

vi.mock('@/lib/core/config/env', () => ({
  getEnv: (name: string) => (name === 'APPS_PROXY_HOP_SECRET' ? SECRET : undefined),
}))

import { createAppsHopProof, verifyAppsHopProof } from '@/lib/apps/hop-proof'

describe('Apps proxy hop proof', () => {
  it('accepts the exact method and path inside the TTL', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    const body = '{"input":{"name":"Ada"}}'
    const proof = createAppsHopProof('POST', '/api/apps/gateway/releases/r/actions/main', body, now)

    expect(
      verifyAppsHopProof(
        'POST',
        '/api/apps/gateway/releases/r/actions/main',
        body,
        proof,
        now + 30_000
      )
    ).toBe(true)
  })

  it('rejects replay against another method, path, body, or expired timestamp', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    const path = '/api/apps/gateway/releases/r/actions/main'
    const body = '{"input":{"amount":10}}'
    const proof = createAppsHopProof('POST', path, body, now)

    expect(verifyAppsHopProof('GET', path, body, proof, now)).toBe(false)
    expect(verifyAppsHopProof('POST', `${path}/other`, body, proof, now)).toBe(false)
    expect(verifyAppsHopProof('POST', path, '{"input":{"amount":11}}', proof, now)).toBe(false)
    expect(verifyAppsHopProof('POST', path, body, proof, now + 60_001)).toBe(false)
  })
})
