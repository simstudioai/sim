/** @vitest-environment jsdom */
import { act, type ComponentProps, type ReactNode } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizedApp, AuthorizedAppsPage } from '@/lib/api/contracts/user'
import { useOrganizationChatModeStore } from '@/stores/organization-chat-mode/store'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  push: vi.fn(),
  resourcePanel: vi.fn(),
  chat: vi.fn(),
  composer: vi.fn(),
  renderer: vi.fn(),
  markRead: vi.fn(),
  send: vi.fn(),
  consume: vi.fn(),
  sources: vi.fn(),
  apiKeys: vi.fn(),
  authorizedApps: vi.fn(),
  fetchNextPage: vi.fn(),
  upload: vi.fn(),
  addResource: vi.fn(),
}))
vi.mock('@/blocks/integration-matcher', () => ({ mentionifyIntegrations: (text: string) => text }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ fetchQuery: vi.fn() }) }))
vi.mock('@/app/workspace/[workspaceId]/home/hooks/use-resource-panel', () => ({
  useResourcePanelController: () => ({
    onResourceEvent: undefined,
    activeResourceState: undefined,
  }),
  useChatResourcePanel: () => ({
    isResourceCollapsed: true,
    addResourceFromUser: mocks.addResource,
    prepareResourceViewForAgentTurn: vi.fn(),
  }),
}))
vi.mock('@/app/workspace/[workspaceId]/home/components/chat-resource-panel', () => ({
  ChatResourcePanel: mocks.resourcePanel,
}))
vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'reader' } } }),
}))
vi.mock('@/lib/uploads/client/session-upload', () => ({ uploadInternalFileSession: mocks.upload }))
vi.mock('@/lib/core/utils/browser-storage', () => ({
  MothershipHandoffStorage: { consume: mocks.consume },
}))
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => ({
  useOrganizationContext: mocks.context,
}))
vi.mock('@/app/workspace/[workspaceId]/home/hooks/use-chat', () => ({ useChat: mocks.chat }))
vi.mock('@/hooks/queries/mothership-chats', () => ({
  useMarkMothershipChatRead: () => ({ mutate: mocks.markRead }),
}))
vi.mock('@/app/o/[organizationId]/home/components/composer', () => ({ Composer: mocks.composer }))
vi.mock('@/app/workspace/[workspaceId]/home/components/suggested-actions', () => ({
  SuggestedActions: ({ onSelectPrompt }: { onSelectPrompt: (prompt: string) => void }) => (
    <button onClick={() => onSelectPrompt('Create a CRM with sample data.')}>
      Suggested actions
    </button>
  ),
}))
vi.mock('@/hooks/queries/kb/connectors', () => ({ useSearchSourceOverview: mocks.sources }))
vi.mock('@/hooks/queries/api-keys', () => ({ useApiKeys: mocks.apiKeys }))
vi.mock('@/hooks/queries/oauth-provider', () => ({ useAuthorizedApps: mocks.authorizedApps }))
vi.mock('@/app/workspace/[workspaceId]/home/components/mothership-chat', () => ({
  MothershipChat: mocks.renderer,
}))

import type { Composer } from '@/app/o/[organizationId]/home/components/composer'
import { OrganizationHome } from '@/app/o/[organizationId]/home/organization-home'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks()
  useOrganizationChatModeStore.setState({ modes: {} })
  mocks.resourcePanel.mockImplementation(({ children }: { children: ReactNode }) => children)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:image-preview')
      static revokeObjectURL = vi.fn()
    }
  )
  mocks.upload.mockResolvedValue({ key: 'image-key', path: '/image-path' })
  mocks.context.mockReturnValue({
    organization: { id: 'organization-a', name: 'Acme' },
    searchAccess: { memberScoped: true },
    mothershipAvailable: true,
    canBuild: true,
    viewer: { isAdmin: false, canUseSearchMcp: true },
  })
  mocks.sources.mockReturnValue({ data: { providers: [], hasSearchableDocuments: false } })
  mocks.apiKeys.mockReturnValue({ data: { personalKeys: [] } })
  mockAuthorizedApps([{ apps: [], nextCursor: null }])
  mocks.chat.mockReturnValue({
    messages: [],
    resources: [],
    isChatHistoryPending: true,
    sendMessage: mocks.send,
  })
  mocks.composer.mockReturnValue(<div>Question composer</div>)
  mocks.renderer.mockReturnValue(<div>Chat history</div>)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
function renderHome(element: ReactNode, searchParams = '') {
  root.render(
    <NuqsTestingAdapter hasMemory searchParams={searchParams}>
      {element}
    </NuqsTestingAdapter>
  )
}
function composerProps(): ComponentProps<typeof Composer> {
  return mocks.composer.mock.lastCall![0]
}

function hasCompletedMcpStep() {
  const link = container.querySelector('a[href="/o/organization-a/settings/search-mcp"]')
  expect(link).not.toBeNull()
  return link!.querySelector('span[aria-hidden="true"] svg') !== null
}

function authorizedApp(scopes: string[], clientId = 'search-client'): AuthorizedApp {
  return { clientId, name: clientId, scopes, authorizedAt: '2026-09-01T00:00:00.000Z' }
}

function mockAuthorizedApps(
  pages: AuthorizedAppsPage[],
  state: { isFetching?: boolean; isError?: boolean } = {}
) {
  mocks.authorizedApps.mockReturnValue({
    data: { pages },
    fetchNextPage: mocks.fetchNextPage,
    hasNextPage: Boolean(pages.at(-1)?.nextCursor),
    isFetching: false,
    isError: false,
    ...state,
  })
}

describe('organization home', () => {
  it.each([undefined, 'chat-a'])(
    'does not mount Home or chat %s when Mothership is unavailable',
    async (chatId) => {
      mocks.context.mockReturnValue({ searchAccess: { memberScoped: false } })
      await act(async () => renderHome(<OrganizationHome chatId={chatId} />))
      expect(container.textContent).toBe('')
      expect(mocks.composer).not.toHaveBeenCalled()
      expect(mocks.chat).not.toHaveBeenCalled()
      expect(mocks.consume).not.toHaveBeenCalled()
      expect(mocks.renderer).not.toHaveBeenCalled()
    }
  )

  it('greets the viewer over the composer and steps while the history query is pending', async () => {
    await act(async () => renderHome(<OrganizationHome userName='Ada Lovelace' />))
    expect(container.textContent).toContain('What should we get done, Ada?')
    expect(container.textContent).toContain('Question composer')
    expect(container.textContent).toContain('Suggested actions')
    expect(container.textContent).not.toContain('Get started')
    expect(mocks.renderer).not.toHaveBeenCalled()
    expect(mocks.chat).toHaveBeenCalledWith(
      { organizationId: 'organization-a' },
      undefined,
      expect.objectContaining({
        requestMode: 'agent',
      })
    )
  })
  it('keeps history loading scoped to an actual routed chat', async () => {
    await act(async () => renderHome(<OrganizationHome chatId='chat-a' />))
    expect(mocks.renderer).toHaveBeenCalledWith(
      expect.objectContaining({ isLoading: true }),
      undefined
    )
    expect(container.textContent).not.toContain('Get started')
    expect(mocks.consume).not.toHaveBeenCalled()
  })
  it('keeps the composer available when messages exist while history is pending', async () => {
    mocks.chat.mockReturnValue({
      resources: [],
      messages: [{ id: 'message-a', role: 'user', content: 'A question' }],
      isChatHistoryPending: true,
      sendMessage: mocks.send,
    })
    await act(async () => renderHome(<OrganizationHome chatId='chat-a' />))
    expect(mocks.renderer).toHaveBeenCalledWith(
      expect.objectContaining({ isLoading: false }),
      undefined
    )
  })
  it('isolates conversation state when switching cached chats', async () => {
    mocks.chat.mockReturnValue({
      resources: [],
      messages: [],
      isChatHistoryPending: false,
      sendMessage: mocks.send,
    })
    mocks.renderer.mockImplementation(({ composer }: { composer: ReactNode }) => composer)
    await act(async () => renderHome(<OrganizationHome chatId='chat-a' />))
    await act(async () => composerProps().onChange('A draft for chat A'))
    await act(async () => renderHome(<OrganizationHome chatId='chat-a' />))
    expect(composerProps().value).toBe('A draft for chat A')
    await act(async () => renderHome(<OrganizationHome chatId='chat-b' />))
    expect(composerProps().value).toBe('')
    expect(mocks.chat).toHaveBeenLastCalledWith(
      { organizationId: 'organization-a' },
      'chat-b',
      expect.objectContaining({
        requestMode: 'agent',
      })
    )
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('preserves the conversation when the first send adopts a chat ID', async () => {
    mocks.renderer.mockImplementation(({ composer }: { composer: ReactNode }) => composer)
    await act(async () => renderHome(<OrganizationHome />))
    await act(async () => composerProps().onChange('A follow-up draft'))
    mocks.chat.mockReturnValue({
      resources: [],
      messages: [{ id: 'message-a', role: 'user', content: 'First question' }],
      resolvedChatId: 'chat-a',
      isChatHistoryPending: true,
      isSending: true,
      sendMessage: mocks.send,
    })
    await act(async () => renderHome(<OrganizationHome />))
    expect(composerProps().value).toBe('A follow-up draft')
    expect(mocks.renderer).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'chat-a', isLoading: false, isSending: true }),
      undefined
    )
  })
  it.each([
    { isAdmin: true, integrationHref: '/o/organization-a/settings/integrations' },
    { isAdmin: false, integrationHref: '/o/organization-a/integrations' },
  ])(
    'routes onboarding for admin=$isAdmin without a workspace creation requirement',
    async ({ isAdmin, integrationHref }) => {
      mocks.context.mockReturnValue({
        organization: { id: 'organization-a', name: 'Acme' },
        searchAccess: { memberScoped: true },
        mothershipAvailable: true,
        canBuild: true,
        viewer: { isAdmin, canUseSearchMcp: true },
      })
      await act(async () => renderHome(<OrganizationHome requestMode='assistant' />))
      expect(
        Array.from(container.querySelectorAll('a')).map((link) => ({
          label: link.textContent,
          href: link.getAttribute('href'),
        }))
      ).toEqual([
        { label: 'Connect an integration', href: integrationHref },
        { label: 'Connect Sim Search MCP', href: '/o/organization-a/settings/search-mcp' },
      ])
      expect(container.textContent).not.toContain('Create a workspace')
      expect(mocks.sources).toHaveBeenCalledWith({
        kind: 'organization',
        organizationId: 'organization-a',
      })
    }
  )
  it('does not complete MCP onboarding for an unrelated personal API key', async () => {
    mocks.apiKeys.mockReturnValue({ data: { personalKeys: [{ id: 'workflow-api-key' }] } })
    await act(async () => renderHome(<OrganizationHome requestMode='assistant' />))
    expect(hasCompletedMcpStep()).toBe(false)
    expect(mocks.apiKeys).not.toHaveBeenCalled()
  })

  it('hides MCP onboarding and stops authorization paging when organization policy blocks access', async () => {
    mocks.context.mockReturnValue({
      organization: { id: 'organization-a', name: 'Acme' },
      searchAccess: { memberScoped: true },
      mothershipAvailable: true,
      canBuild: true,
      viewer: { isAdmin: false, canUseSearchMcp: false },
    })
    mockAuthorizedApps([{ apps: [], nextCursor: 'older-apps' }])
    await act(async () => renderHome(<OrganizationHome requestMode='assistant' />))
    expect(container.textContent).not.toContain('Connect Sim Search MCP')
    expect(container.textContent).toContain('Connect an integration')
    expect(mocks.authorizedApps).toHaveBeenCalledWith('', { enabled: false })
    expect(mocks.fetchNextPage).not.toHaveBeenCalled()
  })

  it.each([
    { scopes: ['search:read'], completed: true },
    { scopes: ['api:read'], completed: true },
    { scopes: ['api:write'], completed: true },
    { scopes: ['offline_access'], completed: false },
    { scopes: [], completed: false },
    { scopes: ['unrecognized:read'], completed: false },
  ])('derives MCP completion from OAuth scopes $scopes', async ({ scopes, completed }) => {
    mockAuthorizedApps([{ apps: [authorizedApp(scopes)], nextCursor: null }])
    await act(async () => renderHome(<OrganizationHome requestMode='assistant' />))
    expect(hasCompletedMcpStep()).toBe(completed)
  })

  it('finds a Search authorization after the first page and stops paging once found', async () => {
    const firstPage = {
      apps: [authorizedApp(['offline_access'], 'other-client')],
      nextCursor: 'older-apps',
    }
    mockAuthorizedApps([firstPage])
    await act(async () => renderHome(<OrganizationHome requestMode='assistant' />))
    expect(hasCompletedMcpStep()).toBe(false)
    expect(mocks.fetchNextPage).toHaveBeenCalledTimes(1)

    mockAuthorizedApps([
      firstPage,
      { apps: [authorizedApp(['search:read'])], nextCursor: 'even-older-apps' },
    ])
    await act(async () => renderHome(<OrganizationHome requestMode='assistant' />))
    expect(hasCompletedMcpStep()).toBe(true)
    expect(mocks.fetchNextPage).toHaveBeenCalledTimes(1)
  })

  it.each([{ isFetching: true }, { isError: true }])(
    'does not start another authorization page request while %j',
    async (state) => {
      mockAuthorizedApps([{ apps: [], nextCursor: 'older-apps' }], state)
      await act(async () => renderHome(<OrganizationHome requestMode='assistant' />))
      expect(mocks.fetchNextPage).not.toHaveBeenCalled()
      expect(hasCompletedMcpStep()).toBe(false)
    }
  )

  it('clears MCP completion when the Search authorization is revoked', async () => {
    mockAuthorizedApps([{ apps: [authorizedApp(['search:read'])], nextCursor: null }])
    await act(async () => renderHome(<OrganizationHome requestMode='assistant' />))
    expect(hasCompletedMcpStep()).toBe(true)

    mockAuthorizedApps([{ apps: [], nextCursor: null }])
    await act(async () => renderHome(<OrganizationHome requestMode='assistant' />))
    expect(hasCompletedMcpStep()).toBe(false)
  })

  it('sends the member question as an assistant turn and clears the draft', async () => {
    await act(async () => renderHome(<OrganizationHome requestMode='assistant' />))
    await act(async () => composerProps().onChange('Find our launch plan'))
    await act(async () => composerProps().onSubmit(composerProps().value))
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(
      'Find our launch plan',
      undefined,
      undefined,
      { requestMode: 'assistant' }
    )
    expect(composerProps().value).toBe('')
  })
  it('ignores a blank submission', async () => {
    await act(async () => renderHome(<OrganizationHome requestMode='assistant' />))
    await act(async () => composerProps().onChange('   '))
    await act(async () => composerProps().onSubmit(composerProps().value))
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('sends image-only turns with canonical attachment properties and clears the draft', async () => {
    await act(async () => renderHome(<OrganizationHome requestMode='assistant' />))
    const files = [new File(['image'], 'screenshot.png', { type: 'image/png' })]
    await act(async () =>
      composerProps().files.processFiles(
        Object.assign(files, { item: (index: number) => files[index] ?? null })
      )
    )
    await act(async () => composerProps().onSubmit(composerProps().value))
    expect(mocks.send).toHaveBeenCalledWith(
      '',
      [
        expect.objectContaining({
          id: expect.any(String),
          key: 'image-key',
          filename: 'screenshot.png',
          media_type: 'image/png',
          size: 5,
          path: '/image-path',
        }),
      ],
      undefined,
      { requestMode: 'assistant' }
    )
    expect(composerProps().files.attachedFiles).toEqual([])
  })

  it('restores queued images when editing and includes them in the replacement turn', async () => {
    mocks.renderer.mockImplementation(({ composer }: { composer: ReactNode }) => composer)
    const attachments = [
      {
        id: 'image-a',
        key: 'image-key',
        filename: 'screenshot.png',
        media_type: 'image/png',
        size: 5,
      },
    ]
    mocks.chat.mockReturnValue({
      resources: [],
      messages: [],
      sendMessage: mocks.send,
      editQueuedMessage: () => ({
        id: 'queued-a',
        content: 'Explain this',
        fileAttachments: attachments,
      }),
    })
    await act(async () => renderHome(<OrganizationHome chatId='chat-a' requestMode='assistant' />))
    await act(async () => mocks.renderer.mock.lastCall![0].onEditQueuedMessage('queued-a'))
    expect(composerProps().files.attachedFiles[0]).toEqual(
      expect.objectContaining({
        name: 'screenshot.png',
        key: 'image-key',
        uploading: false,
        path: '/api/files/serve/image-key?context=mothership&preview=1',
      })
    )
    await act(async () => composerProps().onSubmit(composerProps().value))
    expect(mocks.send).toHaveBeenCalledWith(
      'Explain this',
      [{ ...attachments[0], path: '/api/files/serve/image-key?context=mothership&preview=1' }],
      undefined,
      {
        requestMode: 'assistant',
      }
    )
  })

  it('resumes image-only handoffs without dropping their attachments', async () => {
    const attachments = [
      {
        id: 'image-a',
        key: 'image-key',
        filename: 'screenshot.png',
        media_type: 'image/png',
        size: 5,
      },
    ]
    mocks.consume.mockReturnValueOnce({ message: '', fileAttachments: attachments })
    await act(async () => renderHome(<OrganizationHome requestMode='assistant' />))
    expect(mocks.send).toHaveBeenCalledWith('', attachments, undefined, {
      requestMode: 'assistant',
    })
  })
  it('resumes a scoped handoff with the original search filters', async () => {
    const assistantSearch = { documentIds: ['document-a'] }
    mocks.consume.mockReturnValueOnce({ message: 'Summarize', assistantSearch })
    await act(async () => renderHome(<OrganizationHome requestMode='assistant' />))
    expect(mocks.consume).toHaveBeenCalledWith(
      { organizationId: 'organization-a' },
      undefined,
      'assistant'
    )
    expect(mocks.send).toHaveBeenCalledWith('Summarize', undefined, undefined, {
      requestMode: 'assistant',
      assistantSearch,
    })
  })
})

it('uses agent mode on new Home and does not consume a Search handoff', async () => {
  mocks.context.mockReturnValue({
    organization: { id: 'organization-a', name: 'Acme' },
    mothershipAvailable: true,
    canBuild: true,
    searchAccess: { memberScoped: false },
  })
  await act(async () => renderHome(<OrganizationHome />))
  await act(async () => composerProps().onChange('Update the workflow'))
  await act(async () => composerProps().onSubmit(composerProps().value))
  expect(mocks.send).toHaveBeenCalledWith('Update the workflow', undefined, undefined, {
    requestMode: 'agent',
  })
  expect(mocks.consume).toHaveBeenCalledWith(
    { organizationId: 'organization-a' },
    undefined,
    'agent'
  )
  expect(mocks.sources).not.toHaveBeenCalled()
})

describe('Home permission-selected harness', () => {
  it('defaults to Mothership when workspace creation is allowed', async () => {
    await act(async () => renderHome(<OrganizationHome />))
    expect(composerProps().requestMode).toBe('agent')
    expect(mocks.resourcePanel).toHaveBeenLastCalledWith(
      expect.objectContaining({ searchRequest: undefined }),
      undefined
    )
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('defaults to Assistant when workspace creation is forbidden', async () => {
    mocks.context.mockReturnValue({ ...mocks.context(), canBuild: false })
    await act(async () => renderHome(<OrganizationHome />))
    expect(composerProps().requestMode).toBe('assistant')
    expect(mocks.resourcePanel).toHaveBeenLastCalledWith(
      expect.objectContaining({ searchRequest: undefined }),
      undefined
    )
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('retains a saved Search chat for a user who can now Build', async () => {
    mocks.renderer.mockImplementation(({ composer }: { composer: ReactNode }) => composer)
    await act(async () => renderHome(<OrganizationHome chatId='chat-a' requestMode='assistant' />))
    expect(composerProps().requestMode).toBe('assistant')
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('shows fast results for the latest user query while the Assistant is still working', async () => {
    mocks.chat.mockReturnValue({
      resources: [],
      messages: [
        { id: '1', role: 'user', content: 'Older query' },
        { id: '2', role: 'assistant', content: 'Earlier answer' },
        { id: '3', role: 'user', content: 'Orion release checks' },
      ],
      isSending: true,
      sendMessage: mocks.send,
    })
    await act(async () =>
      renderHome(<OrganizationHome chatId='search-a' requestMode='assistant' />)
    )
    expect(mocks.resourcePanel).toHaveBeenLastCalledWith(
      expect.objectContaining({
        organizationId: 'organization-a',
        searchRequest: { messageId: '3', query: 'Orion release checks' },
      }),
      undefined
    )
    expect(mocks.chat).toHaveBeenLastCalledWith(
      { organizationId: 'organization-a' },
      'search-a',
      expect.objectContaining({ requestMode: 'assistant', projectsDesktopTabs: false })
    )
  })
  it('keeps old Build history readable after permission removal without a writable composer', async () => {
    mocks.context.mockReturnValue({ ...mocks.context(), canBuild: false })
    mocks.renderer.mockImplementation(({ composer }: { composer: ReactNode }) => composer)
    await act(async () => renderHome(<OrganizationHome chatId='chat-a' requestMode='agent' />))
    expect(mocks.composer).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Build requires permission')
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/o/organization-a/home')
    expect(mocks.send).not.toHaveBeenCalled()
  })
})

it('passes explicitly selected skill workspace contexts through the ordinary Build send', async () => {
  await act(async () => renderHome(<OrganizationHome />))
  const contexts = [
    { kind: 'skill' as const, skillId: 'skill-a', label: 'review', workspaceId: 'workspace-a' },
  ]
  await act(async () => composerProps().onSubmit('/review Check this draft', contexts))
  expect(mocks.send).toHaveBeenCalledWith('/review Check this draft', undefined, contexts, {
    requestMode: 'agent',
  })
})

describe('same-chat mode selection', () => {
  it('preserves an existing chat and draft and applies the selected harness to its next turn', async () => {
    mocks.renderer.mockImplementation(({ composer }: { composer: ReactNode }) => composer)
    await act(async () => renderHome(<OrganizationHome chatId='chat-a' requestMode='agent' />))
    await act(async () => composerProps().onChange('Keep this draft'))
    await act(async () => composerProps().onModeChange?.('assistant'))
    expect(composerProps().value).toBe('Keep this draft')
    expect(composerProps().requestMode).toBe('assistant')
    expect(mocks.push).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.chat).toHaveBeenLastCalledWith(
      { organizationId: 'organization-a' },
      'chat-a',
      expect.objectContaining({ requestMode: 'assistant' })
    )
    await act(async () => composerProps().onSubmit('Keep this draft'))
    expect(mocks.send).toHaveBeenLastCalledWith('Keep this draft', undefined, undefined, {
      requestMode: 'assistant',
    })
    expect(useOrganizationChatModeStore.getState().modes['reader:organization-a']).toBe('assistant')
  })
  it('uses only this user and organization preference for new chats without changing saved chats', async () => {
    const store = useOrganizationChatModeStore.getState()
    store.setMode('other-user', 'organization-a', 'assistant')
    store.setMode('reader', 'other-org', 'assistant')
    await act(async () => renderHome(<OrganizationHome />))
    expect(composerProps().requestMode).toBe('agent')
    await act(async () => store.setMode('reader', 'organization-a', 'assistant'))
    expect(composerProps().requestMode).toBe('assistant')
    mocks.renderer.mockImplementation(({ composer }: { composer: ReactNode }) => composer)
    await act(async () => renderHome(<OrganizationHome chatId='chat-a' requestMode='agent' />))
    expect(composerProps().requestMode).toBe('agent')
    expect(useOrganizationChatModeStore.getState().modes['reader:organization-a']).toBe('assistant')
  })
  it.each(['isSending', 'isReconnecting', 'messageQueue'] as const)(
    'blocks changes while %s is active',
    async (field) => {
      mocks.chat.mockReturnValue({
        ...mocks.chat(),
        [field]: field === 'messageQueue' ? [{ id: 'queued' }] : true,
      })
      await act(async () => renderHome(<OrganizationHome />))
      expect(composerProps().modeChangeDisabled).toBe(true)
      await act(async () => composerProps().onModeChange?.('assistant'))
      expect(composerProps().requestMode).toBe('agent')
      expect(useOrganizationChatModeStore.getState().modes).toEqual({})
    }
  )
  it('offers only Search without a picker when creation is forbidden', async () => {
    mocks.context.mockReturnValue({ ...mocks.context(), canBuild: false })
    await act(async () => renderHome(<OrganizationHome />))
    expect(composerProps().showModeSelector).toBe(false)
    expect(composerProps().requestMode).toBe('assistant')
    await act(async () => composerProps().onModeChange?.('agent'))
    expect(composerProps().requestMode).toBe('assistant')
  })
})

it('does not seed results for a Build turn just because Search is selected next', async () => {
  mocks.chat.mockReturnValue({
    ...mocks.chat(),
    messages: [{ id: 'user-1', role: 'user', content: 'Build a table', requestMode: 'agent' }],
  })
  mocks.renderer.mockImplementation(({ composer }: { composer: ReactNode }) => composer)
  await act(async () => renderHome(<OrganizationHome chatId='chat-a' requestMode='agent' />))
  await act(async () => composerProps().onModeChange?.('assistant'))
  expect(mocks.resourcePanel).toHaveBeenLastCalledWith(
    expect.objectContaining({ searchRequest: undefined }),
    undefined
  )
})

it('keeps the latest submitted Search query when the next turn is switched to Build', async () => {
  mocks.chat.mockReturnValue({
    ...mocks.chat(),
    messages: [
      { id: 'user-1', role: 'user', content: 'Find the release note', requestMode: 'assistant' },
    ],
  })
  mocks.renderer.mockImplementation(({ composer }: { composer: ReactNode }) => composer)
  await act(async () => renderHome(<OrganizationHome chatId='chat-a' requestMode='assistant' />))
  await act(async () => composerProps().onModeChange?.('agent'))
  expect(mocks.resourcePanel).toHaveBeenLastCalledWith(
    expect.objectContaining({
      searchRequest: { messageId: 'user-1', query: 'Find the release note' },
    }),
    undefined
  )
})

it('fills the Build draft from suggested actions without sending', async () => {
  await act(async () => renderHome(<OrganizationHome userName='Ada Lovelace' />))
  expect(container.querySelector('h1')?.textContent).toBe('What should we get done, Ada?')
  const suggestion = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Suggested actions'
  )!
  await act(async () => suggestion.click())
  expect(composerProps().value).toBe('Create a CRM with sample data.')
  expect(mocks.send).not.toHaveBeenCalled()
})

it('shows staging Search heading and setup steps instead of Build suggestions', async () => {
  await act(async () => renderHome(<OrganizationHome />))
  await act(async () => composerProps().onModeChange?.('assistant'))
  expect(container.querySelector('h1')?.textContent).toBe('Search Acme')
  expect(container.textContent).toContain('Get started')
  expect(container.textContent).not.toContain('Suggested actions')
})
