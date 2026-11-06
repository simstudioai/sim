/**
 * @vitest-environment jsdom
 *
 * Transient states a browser run cannot hold still. Failure modes: the landing rendering before the
 * session arrives, and a restored chat entry flashing the dashboard while the router takes over.
 */
import { act, type ReactNode } from 'react'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { integrationMatcherMock } from '@sim/testing/mocks/integration-matcher.mock'
import { kbConnectorsQueriesMock } from '@sim/testing/mocks/kb-connectors-queries.mock'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
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
  chat: vi.fn(),
  composer: vi.fn(),
}))
vi.mock('@/app/workspace/[workspaceId]/providers/feature-flags-provider', () => ({
  useFeatureFlag: () => false,
}))
vi.mock('@/blocks/integration-matcher', () => integrationMatcherMock)
vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@tanstack/react-query', () => reactQueryMock)
vi.mock('@/app/workspace/[workspaceId]/home/hooks/use-resource-panel', () => ({
  useResourcePanelController: () => ({
    onResourceEvent: undefined,
    activeResourceState: [null, vi.fn()],
    activeResourceParam: null,
  }),
  useChatResourcePanel: () => ({
    isResourceCollapsed: true,
    addResourceFromUser: vi.fn(),
    prepareResourceViewForAgentTurn: vi.fn(),
  }),
}))
vi.mock('@/app/workspace/[workspaceId]/home/components/chat-resource-panel', () => ({
  ChatResourcePanel: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/lib/auth/client', () => authClientMock)
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => organizationProviderMock)
vi.mock('@/app/workspace/[workspaceId]/home/hooks/use-chat', () => ({
  getMothershipUseChatOptions: (options: object) => options,
  useChat: mocks.chat,
}))
vi.mock('@/hooks/queries/mothership-chats', () => ({
  useMarkMothershipChatRead: () => ({ mutate: vi.fn() }),
}))
vi.mock('@/app/o/[organizationId]/home/components/composer', () => ({ Composer: mocks.composer }))
vi.mock('@/app/o/[organizationId]/home/components/get-started', () => ({
  GetStarted: () => <div>Legacy get started</div>,
}))
vi.mock('@/app/workspace/[workspaceId]/home/components/suggested-actions', () => ({
  SuggestedActions: () => <div>Suggested actions</div>,
}))
vi.mock('@/hooks/queries/kb/connectors', () => kbConnectorsQueriesMock)
vi.mock('@/app/workspace/[workspaceId]/home/components/mothership-chat', () => ({
  MothershipChat: () => <div>Conversation view</div>,
}))

import {
  OrganizationConversation,
  type OrganizationLandingSlot,
} from '@/app/o/[organizationId]/components/organization-conversation'

const landing = {
  fallback: <div>Dashboard skeleton</div>,
  render: ({ requestMode, composer, shortcuts }: OrganizationLandingSlot) => (
    <div>
      <div>Dashboard for {requestMode}</div>
      {composer}
      <div data-testid='shortcuts'>{shortcuts}</div>
    </div>
  ),
}

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
  organizationProviderMockFns.mockUseOrganizationContext.mockReturnValue({
    organization: { id: 'organization-a', name: 'Acme' },
    searchAccess: { memberScoped: true },
    mothershipAvailable: true,
    canBuild: false,
    viewer: { isAdmin: false, canUseSearchMcp: true },
  })
  mocks.chat.mockReturnValue({ messages: [], resources: [], sendMessage: vi.fn() })
  mocks.composer.mockReturnValue(<div>Question composer</div>)
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
    await render(<OrganizationConversation requestMode='assistant' landing={landing} />)
    expect(container.textContent).toBe('Dashboard skeleton')
  })

  it('shows no dashboard while a restored chat entry hands itself back to the router', async () => {
    nextNavigationMockFns.mockUsePathname.mockReturnValue('/o/organization-a/search/chat/chat-1')
    await render(<OrganizationConversation requestMode='assistant' landing={landing} />)
    expect(container.textContent).toBe('')
  })
})
