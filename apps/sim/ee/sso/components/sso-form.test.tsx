/**
 * @vitest-environment jsdom
 */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSsoSignIn, mockUseSearchParams, mockRequestJson } = vi.hoisted(() => ({
  mockSsoSignIn: vi.fn(),
  mockUseSearchParams: vi.fn(),
  mockRequestJson: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mockRequestJson }))

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

function renderFirstFrame(search: string): string {
  mockUseSearchParams.mockReturnValue(new URLSearchParams(search))
  return renderToString(<SSOForm registrationDisabled={false} />)
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

  it('rejects an off-origin callbackUrl and falls back to the app entry', () => {
    const html = renderFirstFrame('callbackUrl=https://evil.example.com/steal')

    expect(html).not.toContain('evil.example.com')
    expect(html).toContain(`/login?callbackUrl=${encodeURIComponent('/home')}`)
  })
})
