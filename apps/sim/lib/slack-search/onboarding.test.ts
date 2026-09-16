/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getEnv } = vi.hoisted(() => ({ getEnv: vi.fn() }))

vi.unmock('@/lib/core/utils/urls')
vi.mock('@/lib/core/config/env', () => ({
  env: { NEXT_PUBLIC_APP_URL: 'http://localhost:3000' },
  getEnv,
}))
vi.mock('@/lib/core/config/env-flags', () => ({ isProd: true }))

import { slackSearchOnboardingUrl } from '@/lib/slack-search/onboarding'

describe('Slack onboarding URL', () => {
  beforeEach(() => {
    getEnv.mockReset()
  })

  it.each(['https://staging.example.com', 'https://app.example.com', 'https://search.example.org'])(
    'uses the runtime origin %s instead of the build-time localhost value',
    (origin) => {
      getEnv.mockImplementation((key: string) =>
        key === 'NEXT_PUBLIC_APP_URL' ? origin : undefined
      )
      expect(slackSearchOnboardingUrl('opaque-token')).toBe(
        `${origin}/slack-search/connect/opaque-token`
      )
    }
  )

  it('fails when the runtime public URL is missing instead of using the build-time value', () => {
    expect(() => slackSearchOnboardingUrl('opaque-token')).toThrow(
      'NEXT_PUBLIC_APP_URL must be configured'
    )
  })
})
