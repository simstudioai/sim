import { envMockFns, setEnv } from '@sim/testing/mocks/env.mock'
import { setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@/lib/core/utils/urls')

import { slackSearchOnboardingUrl } from '@/lib/slack-search/onboarding'

setEnv({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })
setEnvFlags({ isProd: true })

describe('Slack onboarding URL', () => {
  beforeEach(() => {
    envMockFns.getEnv.mockReturnValue(undefined)
  })

  it('fails when the runtime public URL is missing instead of using the build-time value', () => {
    expect(() => slackSearchOnboardingUrl('opaque-token')).toThrow(
      'NEXT_PUBLIC_APP_URL must be configured'
    )
  })
})
