import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { emailMailerMock, emailMailerMockFns } from '@sim/testing/mocks/email-mailer.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/messaging/email/mailer', () => emailMailerMock)

import { isEmailVerificationEffectivelyEnabled } from '@/lib/messaging/email/verification'

const mockHasEmailService = emailMailerMockFns.mockHasEmailService

describe('isEmailVerificationEffectivelyEnabled', () => {
  beforeEach(() => {
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
})
