/** @vitest-environment jsdom */

import { act } from 'react'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/auth-client', () => authClientMock)
vi.mock('next/navigation', () => nextNavigationMock)

import { useVerification } from '@/app/(auth)/verify/use-verification'

const mocks = {
  verify: authClientMockFns.mockClient.emailOtp.verifyEmail,
  resend: authClientMockFns.mockClient.emailOtp.sendVerificationOtp,
}

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
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  sessionStorage.clear()
  authClientMockFns.mockUseSession.mockReturnValue({
    data: { user: { email: 'member@example.com', emailVerified: false } },
    refetch: vi.fn(),
  })
  mocks.verify.mockResolvedValue({})
  mocks.resend.mockResolvedValue({})
})

afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ''
  vi.clearAllTimers()
  vi.useRealTimers()
  sessionStorage.clear()
})

describe('verification after opening an enrollment in a new tab', () => {
  it('uses the current account over a previous signup address in the tab', async () => {
    sessionStorage.setItem('verificationEmail', 'previous@example.com')
    const result = renderVerification()
    await act(async () => result.current.resendCode())
    expect(mocks.resend).toHaveBeenCalledWith({
      email: 'member@example.com',
      type: 'email-verification',
    })
  })
})
