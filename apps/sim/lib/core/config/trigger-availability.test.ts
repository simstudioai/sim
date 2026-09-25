import { setEnv } from '@sim/testing/mocks/env.mock'
import { setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  insideRun: vi.fn(() => false),
}))

vi.mock('@/lib/core/config/trigger-runtime', () => ({ isInsideTriggerRun: mocks.insideRun }))

import { isTriggerAvailable } from '@/lib/core/config/trigger-availability'

describe('isTriggerAvailable', () => {
  beforeEach(() => {
    setEnv({ TRIGGER_SECRET_KEY: undefined })
    setEnvFlags({ isTriggerDevEnabled: false })
    mocks.insideRun.mockReturnValue(false)
  })

  it('is available inside a Trigger.dev run whatever the environment says', () => {
    mocks.insideRun.mockReturnValue(true)
    expect(isTriggerAvailable()).toBe(true)
  })

  it('needs both the enable flag and the secret key outside a run', () => {
    setEnvFlags({ isTriggerDevEnabled: true })
    expect(isTriggerAvailable()).toBe(false)
    setEnvFlags({ isTriggerDevEnabled: false })
    setEnv({ TRIGGER_SECRET_KEY: 'fixture-key' })
    expect(isTriggerAvailable()).toBe(false)
    setEnvFlags({ isTriggerDevEnabled: true })
    expect(isTriggerAvailable()).toBe(true)
  })
})
