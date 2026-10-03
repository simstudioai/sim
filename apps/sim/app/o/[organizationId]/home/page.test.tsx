import { authMockFns } from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  mothershipChatLifecycleMock,
  mothershipChatLifecycleMockFns,
} from '@sim/testing/mocks/mothership-chat-lifecycle.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ context: vi.fn() }))

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/lib/organizations/surface', () => ({ getOrganizationSurfaceContext: mocks.context }))
vi.mock('@/lib/mothership/chat/lifecycle', () => mothershipChatLifecycleMock)
vi.mock('@/app/o/[organizationId]/integrations/integrations', () => ({
  OrganizationIntegrations: () => <div>Integrations</div>,
}))
vi.mock('@/app/o/[organizationId]/search/search', () => ({
  OrganizationSearch: () => <div>Standalone Search</div>,
}))
vi.mock('@/app/o/[organizationId]/home/organization-home', () => ({
  OrganizationHome: ({ requestMode }: { requestMode?: string }) => (
    <div data-request-mode={requestMode}>Organization Assistant</div>
  ),
}))

import OrganizationChatPage from '@/app/o/[organizationId]/chat/[chatId]/page'
import OrganizationHomePage from '@/app/o/[organizationId]/home/page'
import OrganizationPage from '@/app/o/[organizationId]/page'
import OrganizationSearchPage from '@/app/o/[organizationId]/search/page'

const mockChat = mothershipChatLifecycleMockFns.mockGetAccessibleCopilotChatAuth

const params = Promise.resolve({ organizationId: 'org-1', chatId: 'chat-1' })
const session = { user: { id: 'viewer', name: 'Taylor' }, session: { id: 'session-1' } }

describe('organization Search page gates', () => {
  beforeEach(() => {
    authMockFns.mockGetSession.mockResolvedValue(session)
    mocks.context.mockResolvedValue({
      mothershipAvailable: true,
      searchAccess: { memberScoped: true },
    })
    mockChat.mockResolvedValue({ type: 'mothership', organizationId: 'org-1', mode: 'agent' })
  })

  it.each([
    ['Home', () => OrganizationHomePage({ params })],
    ['Search', () => OrganizationSearchPage({ params })],
    ['chat', () => OrganizationChatPage({ params })],
    ['organization entry', () => OrganizationPage({ params })],
  ] as const)('denies %s to nonmembers before loading content', async (_name, open) => {
    mocks.context.mockResolvedValue(null)
    await expect(open()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('retains chat authorization and asserted organization checks when enabled', async () => {
    expect(renderToStaticMarkup(await OrganizationChatPage({ params }))).toContain(
      'Organization Assistant'
    )
    expect(mockChat).toHaveBeenCalledWith('chat-1', 'viewer', {
      principal: createSessionPrincipal({ userId: 'viewer' }),
    })
    mockChat.mockResolvedValue({ type: 'mothership', organizationId: 'another-org' })
    await expect(OrganizationChatPage({ params })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('denies Home when neither Build nor Search is allowed despite Mothership availability', async () => {
    mocks.context.mockResolvedValue({
      mothershipAvailable: true,
      canBuild: false,
      searchAccess: { memberScoped: false },
    })
    await expect(OrganizationHomePage({ params })).rejects.toThrow(
      'NEXT_REDIRECT:/workspace?redirect=settings'
    )
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('routes chat URLs exactly where Home routes the same viewer, before loading the chat', async () => {
    mocks.context.mockResolvedValue({
      mothershipAvailable: true,
      canBuild: false,
      searchAccess: { memberScoped: false },
    })
    await expect(OrganizationChatPage({ params })).rejects.toThrow(
      'NEXT_REDIRECT:/workspace?redirect=settings'
    )
    mocks.context.mockResolvedValue({
      mothershipAvailable: false,
      canBuild: false,
      searchAccess: { memberScoped: true },
    })
    await expect(OrganizationChatPage({ params })).rejects.toThrow('NEXT_REDIRECT:/o/org-1/search')
    expect(mockChat).not.toHaveBeenCalled()
  })
})
