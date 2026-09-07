/**
 * @vitest-environment jsdom
 */
import { act, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSsoSignIn, mockUseSearchParams } = vi.hoisted(() => ({
  mockSsoSignIn: vi.fn(),
  mockUseSearchParams: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: mockUseSearchParams,
}))

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('@sim/emcn', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type='button' {...props}>
      {children}
    </button>
  ),
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Label: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
}))

vi.mock('@/lib/auth/auth-client', () => ({
  client: { signIn: { sso: mockSsoSignIn } },
}))

vi.mock('@/app/(auth)/components', () => ({
  AuthFormMessage: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  AuthSubmitButton: ({
    children,
    disabled = false,
    loading = false,
    loadingLabel,
  }: {
    children?: ReactNode
    disabled?: boolean
    loading?: boolean
    loadingLabel: string
  }) => (
    <button type='submit' disabled={disabled || loading}>
      {loading ? loadingLabel : children}
    </button>
  ),
}))

vi.mock('@/lib/core/config/env', () => ({
  getEnv: () => 'true',
  isFalsy: (value: unknown) => value === undefined || value === 'false',
}))

import SSOForm from '@/ee/sso/components/sso-form'

function renderFirstFrame(search: string, registrationDisabled = false): string {
  mockUseSearchParams.mockReturnValue(new URLSearchParams(search))
  return renderToString(<SSOForm registrationDisabled={registrationDisabled} />)
}

let container: HTMLDivElement
let root: Root

function renderInteractive(search = '') {
  mockUseSearchParams.mockReturnValue(new URLSearchParams(search))
  act(() => root.render(<SSOForm registrationDisabled={false} />))
}

async function submitForm() {
  const form = container.querySelector('form')
  expect(form).not.toBeNull()
  await act(async () => {
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

/**
 * `renderToString` produces the markup of the first frame with no effects run,
 * which is exactly the window in which a callback URL seeded from an effect is
 * still the app-entry default.
 */
describe('SSOForm callback URL', () => {
  beforeEach(() => {
    mockUseSearchParams.mockReset()
  })

  it('carries a valid callbackUrl on the first rendered frame', () => {
    const html = renderFirstFrame('callbackUrl=/workspace/abc/w/xyz')

    expect(html).toContain(encodeURIComponent('/workspace/abc/w/xyz'))
  })

  it('falls back to the app entry when no callbackUrl is present', () => {
    const html = renderFirstFrame('')

    expect(html).toContain(`/login?callbackUrl=${encodeURIComponent('/home')}`)
  })

  it('rejects an off-origin callbackUrl and falls back to the app entry', () => {
    const html = renderFirstFrame('callbackUrl=https://evil.example.com/steal')

    expect(html).not.toContain('evil.example.com')
    expect(html).toContain(`/login?callbackUrl=${encodeURIComponent('/home')}`)
  })
})

describe('SSOForm signup cross-link', () => {
  beforeEach(() => {
    mockUseSearchParams.mockReset()
  })

  it('offers signup when registration is enabled', () => {
    const html = renderFirstFrame('')

    expect(html).toContain('Don&#x27;t have an account?')
    expect(html).toContain('/signup')
  })

  /** `/signup` rejects the visitor server-side, so linking there is a dead end. */
  it('hides signup when registration is disabled', () => {
    const html = renderFirstFrame('', true)

    expect(html).not.toContain('Don&#x27;t have an account?')
    expect(html).not.toContain('/signup')
  })
})

describe('SSOForm sign-in errors', () => {
  beforeEach(() => {
    mockSsoSignIn.mockReset()
    mockUseSearchParams.mockReset()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('shows an actionable seat message after a successful IdP login cannot provision access', async () => {
    renderInteractive('error=sso_no_seats')

    await act(async () => {})

    expect(container).toHaveTextContent('Your organization has no available seat capacity.')
    expect(container).toHaveTextContent('Ask an administrator to increase capacity')
    expect(container.querySelector('[role="alert"]')).toHaveTextContent(
      'Your organization has no available seat capacity.'
    )
    expect(container.querySelector('#email')).not.toHaveAttribute('aria-invalid')
    expect(container.querySelector('#email')).not.toHaveAttribute('aria-describedby')
  })

  it('shows a generic retryable error when Better Auth resolves with a 404', async () => {
    mockSsoSignIn.mockResolvedValue({
      data: null,
      error: {
        message: 'No provider found for the issuer',
        status: 404,
        statusText: 'Not Found',
      },
    })
    renderInteractive('email=user%40example.com')

    await submitForm()

    expect(container).toHaveTextContent('Unable to start SSO. Check your email and try again.')
    expect(container).not.toHaveTextContent('No provider found for the issuer')
    const submitButton = container.querySelector<HTMLButtonElement>('button[type="submit"]')
    expect(submitButton?.disabled).toBe(false)
    expect(submitButton).toHaveTextContent('Continue with SSO')

    await submitForm()
    expect(mockSsoSignIn).toHaveBeenCalledTimes(2)
  })

  it('does not expose the message from a rejected sign-in request', async () => {
    mockSsoSignIn.mockRejectedValue(new Error('INVALID_EMAIL_DOMAIN'))
    renderInteractive('email=user%40example.com')

    await submitForm()

    expect(container).toHaveTextContent('Unable to start SSO. Check your email and try again.')
    expect(container).not.toHaveTextContent('INVALID_EMAIL_DOMAIN')
    const submitButton = container.querySelector<HTMLButtonElement>('button[type="submit"]')
    expect(submitButton?.disabled).toBe(false)
    expect(submitButton).toHaveTextContent('Continue with SSO')
  })
})
