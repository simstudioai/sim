/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  refetch: vi.fn(),
  verify: vi.fn(),
  resend: vi.fn(),
}))

vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ data: mocks.session(), refetch: mocks.refetch }),
  client: { emailOtp: { verifyEmail: mocks.verify, sendVerificationOtp: mocks.resend } },
}))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))

import { useVerification } from '@/app/(auth)/verify/use-verification'

function useTestVerification() {
  return useVerification({
    hasEmailService: true,
    isProduction: true,
    isEmailVerificationEnabled: true,
  })
}

let root: Root
function renderVerification() {
  const result = { current: undefined as ReturnType<typeof useVerification> | undefined }
  function Harness() {
    result.current = useTestVerification()
    return null
  }
  act(() => root.render(<Harness />))
  return {
    get current() {
      return result.current!
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  sessionStorage.clear()
  mocks.session.mockReturnValue({ user: { email: 'member@example.com', emailVerified: false } })
  mocks.verify.mockResolvedValue({})
  mocks.resend.mockResolvedValue({})
})

afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ''
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

describe('verification after opening an enrollment in a new tab', () => {
  it('resends and verifies for the signed-in user without signup storage', async () => {
    const result = renderVerification()
    expect(result.current.email).toBe('member@example.com')
    await act(async () => result.current.resendCode())
    expect(mocks.resend).toHaveBeenCalledWith({
      email: 'member@example.com',
      type: 'email-verification',
    })
    act(() => result.current.handleOtpChange('123456'))
    await act(async () => result.current.verifyCode())
    expect(mocks.verify).toHaveBeenCalledWith({ email: 'member@example.com', otp: '123456' })
    expect(result.current.status).toBe('verified')
    expect(mocks.refetch).toHaveBeenCalled()
  })

  it('uses the current account over a previous signup address in the tab', async () => {
    sessionStorage.setItem('verificationEmail', 'previous@example.com')
    const result = renderVerification()
    await act(async () => result.current.resendCode())
    expect(mocks.resend).toHaveBeenCalledWith({
      email: 'member@example.com',
      type: 'email-verification',
    })
  })

  it('preserves signup verification before a session exists', async () => {
    mocks.session.mockReturnValue(null)
    sessionStorage.setItem('verificationEmail', 'signup@example.com')
    const result = renderVerification()
    await act(async () => result.current.resendCode())
    expect(mocks.resend).toHaveBeenCalledWith({
      email: 'signup@example.com',
      type: 'email-verification',
    })
  })
})
