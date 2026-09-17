/** @vitest-environment node */
import type { ComponentProps, ReactNode } from 'react'
import { authMockFns } from '@sim/testing'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ app: vi.fn() }))
vi.mock('@sim/emcn', () => ({
  ChipLink: ({ children, href }: ComponentProps<'a'>) => <a href={href}>{children}</a>,
}))
vi.mock('@/app/(auth)/components', () => ({
  AuthShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}))
vi.mock('@/lib/core/config/env-flags', () => ({ isHosted: true }))
vi.mock('@/lib/slack-search/shared-app-env', () => ({
  getSharedSlackSearchAppConfiguration: m.app,
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('Not found')
  },
}))

import SlackInstallPage from '@/app/slack-search/install/[teamId]/page'

beforeEach(() => {
  vi.clearAllMocks()
  m.app.mockReturnValue({ id: 'A1' })
  authMockFns.mockGetSession.mockResolvedValue(null)
})
describe('Slack-initiated install entry', () => {
  it('shows setup guidance without asserting installation or requiring sign-in', async () => {
    const markup = renderToStaticMarkup(
      await SlackInstallPage({ params: Promise.resolve({ teamId: 'T1' }) })
    )
    expect(markup).toContain('Sim Search in Slack')
    expect(markup).not.toContain('is installed')
    expect(markup).toContain('https://slack.com/app_redirect?app=A1&amp;team=T1')
    expect(markup).toContain('href="/home"')
    expect(markup).not.toContain('/login')
    expect(authMockFns.mockGetSession).not.toHaveBeenCalled()
  })
  it('does not infer an organization from an existing Sim session', async () => {
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user' } })
    const markup = renderToStaticMarkup(
      await SlackInstallPage({ params: Promise.resolve({ teamId: 'T1' }) })
    )
    expect(markup).toContain('connect this workspace later')
    expect(authMockFns.mockGetSession).not.toHaveBeenCalled()
  })
  it('rejects malformed workspace hints and unavailable apps before reading a session', async () => {
    await expect(
      SlackInstallPage({ params: Promise.resolve({ teamId: 'https://attacker.test' }) })
    ).rejects.toThrow('Not found')
    m.app.mockReturnValue(null)
    await expect(SlackInstallPage({ params: Promise.resolve({ teamId: 'T1' }) })).rejects.toThrow(
      'Not found'
    )
    expect(authMockFns.mockGetSession).not.toHaveBeenCalled()
  })
})
