/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseSearchParams } = vi.hoisted(() => ({
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
  Button: ({ children }: { children?: ReactNode }) => <button type='button'>{children}</button>,
  Input: () => <input />,
  Label: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
}))

vi.mock('@/lib/auth/auth-client', () => ({
  client: { signIn: { sso: vi.fn() } },
}))

vi.mock('@/app/(auth)/components', () => ({
  AuthSubmitButton: ({ children }: { children?: ReactNode }) => (
    <button type='submit'>{children}</button>
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

/**
 * `renderToString` produces the markup of the first frame with no effects run,
 * which is exactly the window in which a callback URL seeded from an effect is
 * still the `/workspace` default.
 */
describe('SSOForm callback URL', () => {
  beforeEach(() => {
    mockUseSearchParams.mockReset()
  })

  it('carries a valid callbackUrl on the first rendered frame', () => {
    const html = renderFirstFrame('callbackUrl=/workspace/abc/w/xyz')

    expect(html).toContain(encodeURIComponent('/workspace/abc/w/xyz'))
  })

  it('falls back to /workspace when no callbackUrl is present', () => {
    const html = renderFirstFrame('')

    expect(html).toContain(`/login?callbackUrl=${encodeURIComponent('/workspace')}`)
  })

  it('rejects an off-origin callbackUrl and falls back to /workspace', () => {
    const html = renderFirstFrame('callbackUrl=https://evil.example.com/steal')

    expect(html).not.toContain('evil.example.com')
    expect(html).toContain(`/login?callbackUrl=${encodeURIComponent('/workspace')}`)
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
