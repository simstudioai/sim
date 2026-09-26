/**
 * @vitest-environment jsdom
 */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { apiClientRequestMock } from '@sim/testing/mocks/api-client-request.mock'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { envMockFns, resetEnvMock } from '@sim/testing/mocks/env.mock'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { renderToString } from 'react-dom/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/client/request', () => apiClientRequestMock)

vi.mock('next/navigation', () => nextNavigationMock)

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

vi.mock('@/lib/auth/auth-client', () => authClientMock)

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

import SSOForm from '@/ee/sso/components/sso-form'

const mockSsoSignIn = authClientMockFns.mockClient.signIn.sso

const mockUseSearchParams = nextNavigationMockFns.mockUseSearchParams
envMockFns.getEnv.mockReturnValue('true')
afterAll(resetEnvMock)

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
