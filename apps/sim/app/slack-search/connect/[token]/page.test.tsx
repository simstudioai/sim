/** @vitest-environment node */

import type { ComponentProps, ReactNode } from 'react'
import { authMockFns } from '@sim/testing'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  ChipLink: ({ children, href }: ComponentProps<'a'>) => <a href={href}>{children}</a>,
}))
vi.mock('@/app/(auth)/components', () => ({
  AuthShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}))
vi.mock('@/app/slack-search/connect/[token]/slack-search-onboarding', () => ({
  SlackSearchOnboarding: ({ userId }: { userId: string }) => <div>{userId}</div>,
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('Not found')
  },
}))

import SlackSearchOnboardingPage from '@/app/slack-search/connect/[token]/page'

const token = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
  authMockFns.mockGetSession.mockResolvedValue(null)
})

describe('Slack onboarding entry page', () => {
  it('preserves the question context through both signup and login without exposing it', async () => {
    const markup = renderToStaticMarkup(
      await SlackSearchOnboardingPage({ params: Promise.resolve({ token }) })
    )
    const callback = encodeURIComponent(`/slack-search/connect/${token}`)
    expect(markup).toContain(`/signup?callbackUrl=${callback}`)
    expect(markup).toContain(`/login?callbackUrl=${callback}`)
    expect(markup).toContain('Create account')
    expect(markup).toContain('invitation and SSO requirements still apply')
    expect(markup).not.toContain('Retry question')
  })

  it('loads the authenticated onboarding view for the current session', async () => {
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'current-user' } })
    const markup = renderToStaticMarkup(
      await SlackSearchOnboardingPage({ params: Promise.resolve({ token }) })
    )
    expect(markup).toContain('current-user')
    expect(markup).not.toContain('Create account')
  })

  it('rejects malformed context paths before reading a session', async () => {
    await expect(
      SlackSearchOnboardingPage({ params: Promise.resolve({ token: 'invalid' }) })
    ).rejects.toThrow('Not found')
    expect(authMockFns.mockGetSession).not.toHaveBeenCalled()
  })
})
