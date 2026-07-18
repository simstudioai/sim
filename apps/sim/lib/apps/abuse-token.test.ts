/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/core/config/env')>()
  return {
    ...actual,
    getEnv: (name: string) => (name === 'APPS_ABUSE_TOKEN_SECRET' ? 'a'.repeat(32) : undefined),
  }
})

import { issueAppsAbuseToken, verifyAppsAbuseToken } from '@/lib/apps/abuse-token'

describe('apps abuse tokens', () => {
  it('issues a token scoped to the public app and visitor', () => {
    const now = Date.parse('2026-01-01T00:00:00Z')
    const token = issueAppsAbuseToken('public-1', 'visitor-1', now)

    expect(verifyAppsAbuseToken(token, 'public-1', now + 1_000)).toEqual({
      ok: true,
      claims: {
        publicId: 'public-1',
        visitorId: 'visitor-1',
        exp: now + 30 * 60 * 1_000,
      },
    })
  })

  it('rejects a token replayed for another public app', () => {
    const now = Date.parse('2026-01-01T00:00:00Z')
    const token = issueAppsAbuseToken('public-1', 'visitor-1', now)

    expect(verifyAppsAbuseToken(token, 'public-2', now)).toEqual({ ok: false })
  })

  it('rejects expired, malformed, and tampered tokens', () => {
    const now = Date.parse('2026-01-01T00:00:00Z')
    const token = issueAppsAbuseToken('public-1', 'visitor-1', now)
    const [body, signature] = token.split('.')

    expect(verifyAppsAbuseToken(token, 'public-1', now + 30 * 60 * 1_000 + 1)).toEqual({
      ok: false,
    })
    expect(verifyAppsAbuseToken('not-a-token', 'public-1', now)).toEqual({ ok: false })
    expect(verifyAppsAbuseToken(`${body}.${signature}x`, 'public-1', now)).toEqual({ ok: false })
  })
})
