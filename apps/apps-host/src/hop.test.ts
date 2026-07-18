import { describe, expect, it } from 'vitest'
import { createAppsHopProof } from './hop'

describe('Apps Host hop proof', () => {
  it('binds the request body as well as method and path', () => {
    const secret = 'h'.repeat(32)
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    const first = createAppsHopProof(secret, 'POST', '/api/apps/gateway/action', '{"value":1}', now)
    const second = createAppsHopProof(
      secret,
      'POST',
      '/api/apps/gateway/action',
      '{"value":2}',
      now
    )

    expect(first).not.toBe(second)
    expect(first).toBe(
      createAppsHopProof(secret, 'POST', '/api/apps/gateway/action', '{"value":1}', now)
    )
  })
})
