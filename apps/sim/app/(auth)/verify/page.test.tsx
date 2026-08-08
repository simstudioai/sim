/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockHasEmailService, mockIsEmailVerificationEffectivelyEnabled } = vi.hoisted(() => ({
  mockHasEmailService: vi.fn<() => boolean>(),
  mockIsEmailVerificationEffectivelyEnabled: vi.fn<() => boolean>(),
}))

vi.mock('@/lib/messaging/email/mailer', () => ({
  hasEmailService: mockHasEmailService,
}))

vi.mock('@/lib/messaging/email/verification', () => ({
  isEmailVerificationEffectivelyEnabled: mockIsEmailVerificationEffectivelyEnabled,
}))

vi.mock('@/app/(auth)/verify/verify-content', () => ({
  VerifyContent: () => null,
}))

import VerifyPage from '@/app/(auth)/verify/page'

describe('verify page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the verification experience when a mail provider is configured', () => {
    mockHasEmailService.mockReturnValue(true)
    mockIsEmailVerificationEffectivelyEnabled.mockReturnValue(true)

    const element = VerifyPage()

    expect(element.props.hasEmailService).toBe(true)
    expect(element.props.isEmailVerificationEnabled).toBe(true)
  })

  /**
   * The page hands the effective value down, so the verification form never
   * renders on a deployment that cannot deliver a code — it redirects instead.
   */
  it('reports verification off when no mail provider is configured', () => {
    mockHasEmailService.mockReturnValue(false)
    mockIsEmailVerificationEffectivelyEnabled.mockReturnValue(false)

    const element = VerifyPage()

    expect(element.props.hasEmailService).toBe(false)
    expect(element.props.isEmailVerificationEnabled).toBe(false)
  })
})
