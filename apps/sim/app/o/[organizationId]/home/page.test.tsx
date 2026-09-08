/** @vitest-environment node */
import { authMockFns } from '@sim/testing'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ context: vi.fn(), chat: vi.fn() }))

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
  notFound: () => {
    throw new Error('not-found')
  },
}))
vi.mock('@/lib/organizations/surface', () => ({ getOrganizationSurfaceContext: mocks.context }))
vi.mock('@/lib/copilot/chat/lifecycle', () => ({ getAccessibleCopilotChatAuth: mocks.chat }))
vi.mock('@/app/o/[organizationId]/search/search', () => ({
  OrganizationSearch: () => <div>Organization Search</div>,
}))
vi.mock('@/app/o/[organizationId]/integrations/integrations', () => ({
  OrganizationIntegrations: () => <div>Integrations</div>,
}))
vi.mock('@/app/o/[organizationId]/home/organization-home', () => ({
  OrganizationHome: () => <div>Organization Assistant</div>,
}))

import OrganizationChatPage from '@/app/o/[organizationId]/chat/[chatId]/page'
import OrganizationHomePage from '@/app/o/[organizationId]/home/page'
import OrganizationIntegrationsPage from '@/app/o/[organizationId]/integrations/page'
import OrganizationPage from '@/app/o/[organizationId]/page'
import OrganizationSearchPage from '@/app/o/[organizationId]/search/page'

const params = Promise.resolve({ organizationId: 'org-1', chatId: 'chat-1' })
const session = { user: { id: 'viewer', name: 'Taylor' }, session: { id: 'session-1' } }

describe('organization Search page gates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue(session)
    mocks.context.mockResolvedValue({ searchAccess: { memberScoped: true } })
    mocks.chat.mockResolvedValue({ type: 'mothership', organizationId: 'org-1' })
  })

  it.each([
    ['Home', () => OrganizationHomePage({ params })],
    ['Search', () => OrganizationSearchPage({ params })],
    ['chat', () => OrganizationChatPage({ params })],
  ] as const)('redirects %s to workspace settings when Search is disabled', async (_name, open) => {
    mocks.context.mockResolvedValue({ searchAccess: { memberScoped: false, sourceMirrored: true } })
    await expect(open()).rejects.toThrow('redirect:/workspace?redirect=settings')
    expect(mocks.context).toHaveBeenCalledWith('org-1', 'viewer')
    expect(mocks.chat).not.toHaveBeenCalled()
  })

  it.each([
    ['Home', () => OrganizationHomePage({ params })],
    ['Search', () => OrganizationSearchPage({ params })],
    ['chat', () => OrganizationChatPage({ params })],
    ['organization entry', () => OrganizationPage({ params })],
  ] as const)('denies %s to nonmembers before loading content', async (_name, open) => {
    mocks.context.mockResolvedValue(null)
    await expect(open()).rejects.toThrow('not-found')
    expect(mocks.chat).not.toHaveBeenCalled()
  })

  it('hides Integrations when Search is disabled', async () => {
    mocks.context.mockResolvedValue({ searchAccess: { memberScoped: false } })
    await expect(OrganizationIntegrationsPage({ params })).rejects.toThrow('not-found')
  })

  it('renders Home when the organization gate is enabled', async () => {
    expect(renderToStaticMarkup(await OrganizationHomePage({ params }))).toContain(
      'Organization Assistant'
    )
  })

  it('retains chat authorization and asserted organization checks when enabled', async () => {
    expect(renderToStaticMarkup(await OrganizationChatPage({ params }))).toContain(
      'Organization Assistant'
    )
    expect(mocks.chat).toHaveBeenCalledWith('chat-1', 'viewer', {
      principal: { kind: 'session', userId: 'viewer', sessionId: 'session-1' },
    })
    mocks.chat.mockResolvedValue({ type: 'mothership', organizationId: 'another-org' })
    await expect(OrganizationChatPage({ params })).rejects.toThrow('not-found')
  })

  it('lands enabled organizations on Home', async () => {
    await expect(OrganizationPage({ params })).rejects.toThrow('redirect:/o/org-1/home')
  })

  it('preserves the organization entry through sign-in', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)

    await expect(OrganizationPage({ params })).rejects.toThrow(
      'redirect:/login?callbackUrl=%2Fo%2Forg-1'
    )
    expect(mocks.context).not.toHaveBeenCalled()
  })

  it('keeps the organization entry in organization settings when Search is disabled', async () => {
    mocks.context.mockResolvedValue({ searchAccess: { memberScoped: false } })
    await expect(OrganizationPage({ params })).rejects.toThrow('redirect:/o/org-1/settings/members')
    expect(mocks.context).toHaveBeenCalledWith('org-1', 'viewer')
  })

  it('propagates availability failures instead of rendering the Assistant', async () => {
    mocks.context.mockRejectedValue(new Error('Availability unavailable'))
    await expect(OrganizationHomePage({ params })).rejects.toThrow('Availability unavailable')
  })
})
