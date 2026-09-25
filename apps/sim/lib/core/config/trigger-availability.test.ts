import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  env: { TRIGGER_SECRET_KEY: undefined as string | undefined },
  flags: { isTriggerDevEnabled: false },
  insideRun: vi.fn(() => false),
}))

vi.mock('@/lib/core/config/env', () => ({ env: mocks.env }))
vi.mock('@/lib/core/config/env-flags', () => ({
  get isTriggerDevEnabled() {
    return mocks.flags.isTriggerDevEnabled
  },
}))
vi.mock('@/lib/core/config/trigger-runtime', () => ({ isInsideTriggerRun: mocks.insideRun }))

import { isTriggerAvailable } from '@/lib/core/config/trigger-availability'

describe('isTriggerAvailable', () => {
  beforeEach(() => {
    mocks.env.TRIGGER_SECRET_KEY = undefined
    mocks.flags.isTriggerDevEnabled = false
    mocks.insideRun.mockReturnValue(false)
  })

  it('is available inside a Trigger.dev run whatever the environment says', () => {
    mocks.insideRun.mockReturnValue(true)
    expect(isTriggerAvailable()).toBe(true)
  })

  it('needs both the enable flag and the secret key outside a run', () => {
    mocks.flags.isTriggerDevEnabled = true
    expect(isTriggerAvailable()).toBe(false)
    mocks.flags.isTriggerDevEnabled = false
    mocks.env.TRIGGER_SECRET_KEY = 'fixture-key'
    expect(isTriggerAvailable()).toBe(false)
    mocks.flags.isTriggerDevEnabled = true
    expect(isTriggerAvailable()).toBe(true)
  })
})
