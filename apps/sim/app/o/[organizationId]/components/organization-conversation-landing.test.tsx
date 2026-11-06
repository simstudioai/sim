/**
 * @vitest-environment jsdom
 *
 * Transient states a browser run cannot hold still. Failure modes: the landing rendering before the
 * session arrives, and a restored chat entry flashing the dashboard while the router takes over.
 */
import { act, type ReactNode } from 'react'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { featureFlagsProviderMock } from '@sim/testing/mocks/feature-flags-provider.mock'
import { integrationMatcherMock } from '@sim/testing/mocks/integration-matcher.mock'
import { kbConnectorsQueriesMock } from '@sim/testing/mocks/kb-connectors-queries.mock'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import {
  chatResourcePanelMock,
  mothershipChatMock,
  mothershipChatsQueriesMock,
  organizationConversationMockFns,
  useChatMock,
  useResourcePanelMock,
} from '@sim/testing/mocks/organization-conversation.mock'
import {
  organizationProviderMock,
  organizationProviderMockFns,
} from '@sim/testing/mocks/organization-provider.mock'
import {
  createMutationResultMock,
  createQueryResultMock,
  reactQueryMock,
  reactQueryMockFns,
} from '@sim/testing/mocks/react-query.mock'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  composer: vi.fn(),
}))
vi.mock(
  '@/app/workspace/[workspaceId]/providers/feature-flags-provider',
  () => featureFlagsProviderMock
)
vi.mock('@/blocks/integration-matcher', () => integrationMatcherMock)
vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@tanstack/react-query', () => reactQueryMock)
vi.mock('@/app/workspace/[workspaceId]/home/hooks/use-resource-panel', () => useResourcePanelMock)
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/chat-resource-panel',
  () => chatResourcePanelMock
)
vi.mock('@/lib/auth/client', () => authClientMock)
vi.mock('@/lib/organizations/provider', () => organizationProviderMock)
vi.mock('@/app/workspace/[workspaceId]/home/hooks/use-chat', () => useChatMock)
vi.mock('@/hooks/queries/mothership-chats', () => mothershipChatsQueriesMock)
vi.mock('@/platform/app/(shell)/_components/conversation/page-composer', () => ({
  PageComposer: mocks.composer,
}))
vi.mock('@/app/workspace/[workspaceId]/home/components/suggested-actions', () => ({
  SuggestedActions: () => <div>Suggested actions</div>,
}))
vi.mock('@/hooks/queries/kb/connectors', () => kbConnectorsQueriesMock)
vi.mock('@/app/workspace/[workspaceId]/home/components/mothership-chat', () => mothershipChatMock)

import {
  type ConversationLandingSlot,
  PageConversation,
} from '@/platform/app/(shell)/_components/conversation/page-conversation'

const { mockMothershipChat, mockUseChat } = organizationConversationMockFns

const landing = ({ requestMode, composer }: ConversationLandingSlot) => (
  <div>
    <div>Dashboard for {requestMode}</div>
    {composer}
  </div>
)

let root: Root
let container: HTMLDivElement

async function render(element: ReactNode) {
  await act(async () => {
    root.render(<NuqsTestingAdapter hasMemory>{element}</NuqsTestingAdapter>)
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  reactQueryMockFns.mockUseQuery.mockReturnValue(createQueryResultMock())
  reactQueryMockFns.mockUseMutation.mockReturnValue(createMutationResultMock())
  nextNavigationMockFns.mockUsePathname.mockReturnValue('/o/organization-a/home')
  authClientMockFns.mockUseSession.mockReturnValue({ data: { user: { id: 'reader' } } })
  organizationProviderMockFns.mockUseOrganization.mockReturnValue({
    organization: { id: 'organization-a', name: 'Acme' },
    searchAccess: { memberScoped: true },
    mothershipAvailable: true,
    canBuild: false,
    viewer: { isAdmin: false, canUseSearchMcp: true },
  })
  mockUseChat.mockReturnValue({ messages: [], resources: [], sendMessage: vi.fn() })
  mocks.composer.mockReturnValue(<div>Question composer</div>)
  mockMothershipChat.mockReturnValue(<div>Conversation view</div>)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('an Assistant conversation on a surface with its own landing', () => {
  it('holds the surface’s fallback until the session arrives', async () => {
    authClientMockFns.mockUseSession.mockReturnValue({ data: null })
    await render(
      <PageConversation
        requestMode='assistant'
        fallback={<div>Dashboard skeleton</div>}
        landing={landing}
      />
    )
    expect(container.textContent).toBe('Dashboard skeleton')
  })

  it('shows no dashboard while a restored chat entry hands itself back to the router', async () => {
    nextNavigationMockFns.mockUsePathname.mockReturnValue('/o/organization-a/search/chat/chat-1')
    await render(
      <PageConversation
        requestMode='assistant'
        fallback={<div>Dashboard skeleton</div>}
        landing={landing}
      />
    )
    expect(container.textContent).toBe('')
  })
})
