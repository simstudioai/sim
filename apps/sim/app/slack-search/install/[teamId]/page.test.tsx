import type { ComponentProps, ReactNode } from 'react'
import { authMockFns } from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ app: vi.fn() }))
vi.mock('@sim/emcn', () => ({
  ChipLink: ({ children, href }: ComponentProps<'a'>) => <a href={href}>{children}</a>,
}))
vi.mock('@/app/(auth)/components', () => ({
  AuthShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}))
vi.mock('@/lib/slack-search/shared-app-env', () => ({
  getSharedSlackSearchAppConfiguration: m.app,
}))
vi.mock('next/navigation', () => nextNavigationMock)

import SlackInstallPage from '@/app/slack-search/install/[teamId]/page'

setEnvFlags({ isHosted: true })

beforeEach(() => {
  m.app.mockReturnValue({ id: 'A1' })
  authMockFns.mockGetSession.mockResolvedValue(null)
})
describe('Slack-initiated install entry', () => {
  it('does not infer an organization from an existing Sim session', async () => {
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user' } })
    const markup = renderToStaticMarkup(
      await SlackInstallPage(createRouteContext({ teamId: 'T1' }))
    )
    expect(markup).toContain('connect this workspace later')
    expect(authMockFns.mockGetSession).not.toHaveBeenCalled()
  })
  it('rejects malformed workspace hints and unavailable apps before reading a session', async () => {
    await expect(
      SlackInstallPage(createRouteContext({ teamId: 'https://attacker.test' }))
    ).rejects.toThrow('NEXT_NOT_FOUND')
    m.app.mockReturnValue(null)
    await expect(SlackInstallPage(createRouteContext({ teamId: 'T1' }))).rejects.toThrow(
      'NEXT_NOT_FOUND'
    )
    expect(authMockFns.mockGetSession).not.toHaveBeenCalled()
  })
})
