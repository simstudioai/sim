/**
 * @vitest-environment jsdom
 *
 * A surface's own landing must not change the conversation it fronts. Failure modes: Home's
 * Assistant sharing Search's unsent question, a new chat losing its Search address, the landing
 * outliving the first turn, a restored chat entry flashing the dashboard's skeleton, and a caller
 * without a landing (the extension, Search) seeing any of it.
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
import { useMothershipDraftsStore } from '@/stores/mothership-drafts/store'

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  composer: vi.fn(),
  send: vi.fn(),
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

const SEARCH_DRAFT = 'reader:organization:organization-a:search-assistant'
const HOME_DRAFT = 'reader:organization:organization-a:home-assistant'

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

function composerProps() {
  const call = mocks.composer.mock.lastCall
  if (!call) throw new Error('Composer has not rendered')
  return call[0]
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  reactQueryMockFns.mockUseQuery.mockReturnValue(createQueryResultMock())
  reactQueryMockFns.mockUseMutation.mockReturnValue(createMutationResultMock())
  useMothershipDraftsStore.setState({ drafts: {} })
  nextNavigationMockFns.mockUsePathname.mockReturnValue('/o/organization-a/home')
  authClientMockFns.mockUseSession.mockReturnValue({ data: { user: { id: 'reader' } } })
  organizationProviderMockFns.mockUseOrganizationContext.mockReturnValue({
    organization: { id: 'organization-a', name: 'Acme' },
    searchAccess: { memberScoped: true },
    mothershipAvailable: true,
    canBuild: false,
    viewer: { isAdmin: false, canUseSearchMcp: true },
  })
  mocks.chat.mockReturnValue({ messages: [], resources: [], sendMessage: mocks.send })
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
  it('hands its composer and the Assistant shortcuts to the surface’s landing, in place of the default heading', async () => {
    await render(
      <OrganizationConversation
        requestMode='assistant'
        draftId='home-assistant'
        landing={landing}
      />
    )
    expect(container.textContent).toContain('Dashboard for assistant')
    expect(container.textContent).toContain('Question composer')
    expect(container.querySelector('[data-testid="shortcuts"]')?.textContent).toBe(
      'Legacy get started'
    )
    expect(container.querySelector('h1')).toBeNull()
  })

  it('keeps its unsent question apart from Search’s Assistant, in both directions', async () => {
    useMothershipDraftsStore.getState().setDraft(SEARCH_DRAFT, { text: 'Asked from Search' })
    await render(
      <OrganizationConversation
        requestMode='assistant'
        draftId='home-assistant'
        landing={landing}
      />
    )
    expect(composerProps().value).toBe('')
    await act(async () => composerProps().onChange('Asked from Home'))
    const { drafts } = useMothershipDraftsStore.getState()
    expect(drafts[HOME_DRAFT]?.text).toBe('Asked from Home')
    expect(drafts[SEARCH_DRAFT]?.text).toBe('Asked from Search')
  })

  it('addresses a new chat under Search, in the Assistant view', async () => {
    await render(
      <OrganizationConversation
        requestMode='assistant'
        draftId='home-assistant'
        landing={landing}
      />
    )
    const [, chatId, options] = mocks.chat.mock.lastCall ?? []
    expect(chatId).toBeUndefined()
    expect(options.requestMode).toBe('assistant')
    expect(options.getChatUrl('chat-1')).toBe('/o/organization-a/search/chat/chat-1?mode=assistant')
  })

  it('gives way to today’s conversation view at the first turn', async () => {
    mocks.chat.mockReturnValue({
      messages: [{ id: 'turn' }],
      resources: [],
      sendMessage: mocks.send,
    })
    await render(
      <OrganizationConversation
        requestMode='assistant'
        draftId='home-assistant'
        landing={landing}
      />
    )
    expect(container.textContent).toContain('Conversation view')
    expect(container.textContent).not.toContain('Dashboard for')
  })

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

describe('a conversation without a landing', () => {
  it('keeps today’s landing and Search’s draft key', async () => {
    useMothershipDraftsStore.getState().setDraft(SEARCH_DRAFT, { text: 'Asked from Search' })
    await render(<OrganizationConversation requestMode='assistant' />)
    expect(container.querySelector('h1')?.textContent).toBe('Search Acme')
    expect(container.textContent).toContain('Legacy get started')
    expect(composerProps().value).toBe('Asked from Search')
  })
})
