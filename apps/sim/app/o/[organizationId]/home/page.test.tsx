import type { ReactNode } from 'react'
import { authMockFns } from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  mothershipChatLifecycleMock,
  mothershipChatLifecycleMockFns,
} from '@sim/testing/mocks/mothership-chat-lifecycle.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ context: vi.fn(), prefetchHome: vi.fn() }))

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/lib/organizations/surface', () => ({ getOrganizationSurfaceGate: mocks.context }))
vi.mock('@/lib/mothership/chat/lifecycle', () => mothershipChatLifecycleMock)
vi.mock('@/platform/embedded/lib/data/prefetch', () => ({}))
vi.mock('@/platform/embedded/lib/data/prefetch-member-inventory', () => ({
  prefetchHome: mocks.prefetchHome,
}))
vi.mock(
  '@/platform/embedded/app/(shell)/home/_components/home-dashboard/home-dashboard-skeleton',
  () => ({
    HomeDashboardSkeleton: () => <div>Home skeleton</div>,
  })
)
vi.mock('@/platform/design-system/components/surface/hydrated', () => ({
  Hydrated: ({ children }: { children: ReactNode }) => children,
}))
vi.mock(
  '@/platform/embedded/app/(shell)/home/_components/home-conversation/home-conversation',
  () => ({
    HomeConversation: ({ requestMode }: { requestMode: string }) => (
      <div>Home for {requestMode}</div>
    ),
  })
)
vi.mock('@/platform/embedded/app/(shell)/search/_components/search-surface/search-surface', () => ({
  OrganizationSearchSurface: () => <div>Standalone Search</div>,
}))
vi.mock('@/platform/embedded/app/(shell)/_components/conversation/page-conversation', () => ({
  PageConversation: ({ requestMode }: { requestMode?: string }) => (
    <div data-request-mode={requestMode}>Organization Assistant</div>
  ),
}))

import OrganizationChatPage from '@/app/o/[organizationId]/chat/[chatId]/page'
import OrganizationHomePage from '@/app/o/[organizationId]/home/page'
import OrganizationPage from '@/app/o/[organizationId]/page'
import OrganizationSearchPage from '@/app/o/[organizationId]/search/page'

const mockChat = mothershipChatLifecycleMockFns.mockGetAccessibleCopilotChatAuth

const params = Promise.resolve({ organizationId: 'org-1', chatId: 'chat-1' })
const searchParams = Promise.resolve({})
const session = { user: { id: 'viewer', name: 'Taylor' }, session: { id: 'session-1' } }

describe('organization Search page gates', () => {
  beforeEach(() => {
    authMockFns.mockGetSession.mockResolvedValue(session)
    mocks.context.mockResolvedValue({
      mothershipAvailable: true,
      canBuild: true,
      searchAccess: { memberScoped: true },
    })
    mockChat.mockResolvedValue({ type: 'mothership', organizationId: 'org-1', mode: 'agent' })
  })

  it.each([
    ['Home', () => OrganizationHomePage({ params })],
    ['Search', () => OrganizationSearchPage({ params, searchParams })],
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

  const searchOnlyMember = {
    mothershipAvailable: true,
    canBuild: false,
    searchAccess: { memberScoped: true },
  }

  it('gives a search-only member Home with the Assistant, at both of its addresses', async () => {
    mocks.context.mockResolvedValue(searchOnlyMember)
    expect(renderToStaticMarkup(await OrganizationHomePage({ params }))).toContain(
      'Home for assistant'
    )
    await expect(OrganizationPage({ params })).rejects.toThrow('NEXT_REDIRECT:/o/org-1/home')
  })

  it.each([true, false])(
    'gives a builder Home with the agent (Search access: %s)',
    async (memberScoped) => {
      mocks.context.mockResolvedValue({
        mothershipAvailable: true,
        canBuild: true,
        searchAccess: { memberScoped },
      })
      expect(renderToStaticMarkup(await OrganizationHomePage({ params }))).toContain(
        'Home for agent'
      )
      await expect(OrganizationPage({ params })).rejects.toThrow('NEXT_REDIRECT:/o/org-1/home')
    }
  )

  it('sends a member without the Assistant to Search, where Home has no conversation to hold', async () => {
    mocks.context.mockResolvedValue({ ...searchOnlyMember, mothershipAvailable: false })
    await expect(OrganizationHomePage({ params })).rejects.toThrow('NEXT_REDIRECT:/o/org-1/search')
    await expect(OrganizationPage({ params })).rejects.toThrow('NEXT_REDIRECT:/o/org-1/search')
  })

  it('keeps a search-only member out of an agent chat that Home does not entitle them to', async () => {
    mocks.context.mockResolvedValue(searchOnlyMember)
    await expect(OrganizationChatPage({ params })).rejects.toThrow('NEXT_REDIRECT:/o/org-1/search')
  })

  it('sends a viewer with no conversation here away from chat URLs, before loading the chat', async () => {
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
