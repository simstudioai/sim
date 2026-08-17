/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSocialSignIn } = vi.hoisted(() => ({ mockSocialSignIn: vi.fn() }))

vi.mock('@/lib/auth/auth-client', () => ({
  client: { signIn: { social: mockSocialSignIn } },
}))

import { SocialLoginButtons } from '@/app/(auth)/components/social-login-buttons'

let container: HTMLDivElement
let root: Root

function renderGoogleButton() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(
      <SocialLoginButtons
        githubAvailable={false}
        googleAvailable
        microsoftAvailable={false}
        callbackURL='/after-login'
        isProduction
      />
    )
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('SocialLoginButtons Google sign-in', () => {
  it('renders the compliant CTA and 20px logo while preserving the loading state', async () => {
    let finishSignIn: (() => void) | undefined
    mockSocialSignIn.mockReturnValue(
      new Promise<void>((resolve) => {
        finishSignIn = resolve
      })
    )
    renderGoogleButton()

    const button = container.querySelector('button') as HTMLButtonElement
    const icon = button.querySelector('svg')

    expect(button).toBeEnabled()
    expect(button).toHaveTextContent('Continue with Google')
    expect(icon).toHaveClass('size-[20px]')

    await act(async () => {
      button.click()
    })

    expect(mockSocialSignIn).toHaveBeenCalledWith({
      provider: 'google',
      callbackURL: '/after-login',
    })
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Connecting…')

    await act(async () => {
      finishSignIn?.()
    })

    expect(button).toBeEnabled()
    expect(button).toHaveTextContent('Continue with Google')
  })
})
