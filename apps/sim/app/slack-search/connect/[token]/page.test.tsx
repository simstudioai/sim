import type { ComponentProps, ReactNode } from 'react'
import { authMockFns } from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
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
vi.mock('next/navigation', () => nextNavigationMock)

import SlackSearchOnboardingPage from '@/app/slack-search/connect/[token]/page'

const token = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  authMockFns.mockGetSession.mockResolvedValue(null)
})

describe('Slack onboarding entry page', () => {
  it('preserves the question context through both signup and login without exposing it', async () => {
    const markup = renderToStaticMarkup(
      await SlackSearchOnboardingPage(createRouteContext({ token }))
    )
    const callback = encodeURIComponent(`/slack-search/connect/${token}`)
    expect(markup).toContain(`/signup?callbackUrl=${callback}`)
    expect(markup).toContain(`/login?callbackUrl=${callback}`)
    expect(markup).toContain('Create account')
    expect(markup).toContain('invitation and SSO requirements still apply')
    expect(markup).not.toContain('Retry question')
  })

  it('rejects malformed context paths before reading a session', async () => {
    await expect(
      SlackSearchOnboardingPage(createRouteContext({ token: 'invalid' }))
    ).rejects.toThrow('NEXT_NOT_FOUND')
    expect(authMockFns.mockGetSession).not.toHaveBeenCalled()
  })
})
