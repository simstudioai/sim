/** @vitest-environment jsdom */
import { act, type InputHTMLAttributes, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SignupForm from '@/app/(auth)/signup/signup-form'

const { push, signUp, refetchSession } = vi.hoisted(() => ({
  push: vi.fn(),
  signUp: vi.fn(),
  refetchSession: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@marsidev/react-turnstile', () => ({ Turnstile: () => null }))
vi.mock('posthog-js/react', () => ({ usePostHog: () => null }))
vi.mock('@/lib/analytics/google', () => ({ trackGoogleEvent: vi.fn() }))
vi.mock('@/lib/auth/auth-client', () => ({
  client: { signUp: { email: signUp } },
  useSession: () => ({ refetch: refetchSession }),
}))
vi.mock('@/lib/consent/tracking-consent', () => ({
  useTrackingConsent: () => ({ measurement: false }),
}))
vi.mock('@/lib/core/config/env', () => ({ getEnv: () => undefined, isFalsy: () => false }))
vi.mock('@/lib/core/config/env-flags', () => ({ isSsoEnabled: false }))
vi.mock('@/lib/core/security/input-validation', () => ({ validateCallbackUrl: () => false }))
vi.mock('@/lib/messaging/email/validation', () => ({
  quickValidateEmail: () => ({ isValid: true }),
}))
vi.mock('@/lib/posthog/client', () => ({ captureClientEvent: vi.fn(), captureEvent: vi.fn() }))
vi.mock('@/app/(auth)/components', () => ({
  AuthDivider: () => null,
  AuthField: ({ children }: { children: ReactNode }) => <>{children}</>,
  AuthFormMessage: () => null,
  AuthHeader: () => null,
  AuthInput: ({ error, ...props }: InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) => (
    <input {...props} />
  ),
  AuthLegalFooter: () => null,
  AuthNavPrompt: () => null,
  AuthSubmitButton: ({ children }: { children: ReactNode }) => (
    <button type='submit'>{children}</button>
  ),
  PasswordInput: ({
    error,
    ...props
  }: InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) => <input {...props} />,
  SocialLoginButtons: () => null,
  SSOLoginButton: () => null,
}))

let root: Root
let host: HTMLDivElement
let destination: { href: string }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  destination = { href: '' }
  const browser = window
  vi.stubGlobal(
    'window',
    new Proxy(browser, {
      get(target, key) {
        return key === 'location' ? destination : Reflect.get(target, key, target)
      },
    })
  )
  signUp.mockResolvedValue({ data: { user: { id: 'new-user' } } })
  refetchSession.mockResolvedValue(undefined)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

async function submit(emailVerificationEnabled: boolean) {
  act(() =>
    root.render(
      <SignupForm
        githubAvailable={false}
        googleAvailable={false}
        microsoftAvailable={false}
        emailSignupEnabled
        emailVerificationEnabled={emailVerificationEnabled}
      />
    )
  )
  const fields = { name: 'Test Builder', email: 'builder@example.com', password: 'SafePass1!' }
  for (const [name, value] of Object.entries(fields)) {
    const input = host.querySelector<HTMLInputElement>(`input[name="${name}"]`)
    if (!input) throw new Error(`Missing ${name} input`)
    input.value = value
  }
  const form = host.querySelector('form')
  if (!form) throw new Error('Missing signup form')
  await act(async () =>
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  )
}

describe('signup shell navigation', () => {
  it('starts a document navigation after a successful signup without verification', async () => {
    await submit(false)
    expect(signUp).toHaveBeenCalledOnce()
    expect(refetchSession).toHaveBeenCalledOnce()
    expect(destination.href).toBe('/home')
    expect(push).not.toHaveBeenCalled()
  })

  it('keeps verification within the auth shell and stores the email for the next step', async () => {
    await submit(true)
    expect(push).toHaveBeenCalledWith('/verify?fromSignup=true')
    expect(sessionStorage.getItem('verificationEmail')).toBe('builder@example.com')
    expect(destination.href).toBe('')
  })

  it('does not navigate when signup fails', async () => {
    signUp.mockResolvedValue({ error: { message: 'Signup failed' } })
    await submit(false)
    expect(push).not.toHaveBeenCalled()
    expect(destination.href).toBe('')
  })
})
