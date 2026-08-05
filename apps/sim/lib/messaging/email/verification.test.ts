/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockHasEmailService } = vi.hoisted(() => ({
  mockHasEmailService: vi.fn<() => boolean>(),
}))

vi.mock('@/lib/messaging/email/mailer', () => ({
  hasEmailService: mockHasEmailService,
}))

import { isEmailVerificationEffectivelyEnabled } from '@/lib/messaging/email/verification'

describe('isEmailVerificationEffectivelyEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetEnvFlagsMock()
  })

  afterAll(resetEnvFlagsMock)

  it('requires verification when it is enabled and a mail provider is configured', () => {
    setEnvFlags({ isEmailVerificationEnabled: true })
    mockHasEmailService.mockReturnValue(true)

    expect(isEmailVerificationEffectivelyEnabled()).toBe(true)
  })

  it('does not require verification when no mail provider is configured', () => {
    setEnvFlags({ isEmailVerificationEnabled: true })
    mockHasEmailService.mockReturnValue(false)

    expect(isEmailVerificationEffectivelyEnabled()).toBe(false)
  })

  it('does not require verification when the feature is disabled', () => {
    setEnvFlags({ isEmailVerificationEnabled: false })
    mockHasEmailService.mockReturnValue(true)

    expect(isEmailVerificationEffectivelyEnabled()).toBe(false)
  })
})
