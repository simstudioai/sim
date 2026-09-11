/** @vitest-environment jsdom */
import { act, type ComponentProps, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizedApp, AuthorizedAppsPage } from '@/lib/api/contracts/user'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
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
    organization: { id: 'organization-a' },
    searchAccess: { memberScoped: true },
    viewer: { isAdmin: false, canUseSearchMcp: true },
  })
  mocks.sources.mockReturnValue({ data: { providers: [], hasSearchableDocuments: false } })
  mocks.apiKeys.mockReturnValue({ data: { personalKeys: [] } })
  mockAuthorizedApps([{ apps: [], nextCursor: null }])
  mocks.chat.mockReturnValue({ messages: [], isChatHistoryPending: true, sendMessage: mocks.send })
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
    'does not mount Home or chat %s when Search is disabled',
    async (chatId) => {
      mocks.context.mockReturnValue({ searchAccess: { memberScoped: false } })
      await act(async () => root.render(<OrganizationHome chatId={chatId} />))
      expect(container.textContent).toBe('')
      expect(mocks.composer).not.toHaveBeenCalled()
      expect(mocks.chat).not.toHaveBeenCalled()
      expect(mocks.consume).not.toHaveBeenCalled()
      expect(mocks.renderer).not.toHaveBeenCalled()
    }
  )

  it('greets the viewer over the composer and steps while the history query is pending', async () => {
    await act(async () => root.render(<OrganizationHome userName='Ada Lovelace' />))
    expect(container.textContent).toContain('What should we get done, Ada?')
    expect(container.textContent).toContain('Question composer')
    expect(container.textContent).toContain('Get started')
    expect(mocks.renderer).not.toHaveBeenCalled()
    expect(mocks.chat).toHaveBeenCalledWith({ organizationId: 'organization-a' }, undefined)
  })
  it('keeps history loading scoped to an actual routed chat', async () => {
    await act(async () => root.render(<OrganizationHome chatId='chat-a' />))
    expect(mocks.renderer).toHaveBeenCalledWith(
      expect.objectContaining({ isLoading: true }),
      undefined
    )
    expect(container.textContent).not.toContain('Get started')
    expect(mocks.consume).not.toHaveBeenCalled()
  })
  it('keeps the composer available when messages exist while history is pending', async () => {
    mocks.chat.mockReturnValue({
      messages: [{ id: 'message-a', role: 'user', content: 'A question' }],
      isChatHistoryPending: true,
      sendMessage: mocks.send,
    })
    await act(async () => root.render(<OrganizationHome chatId='chat-a' />))
    expect(mocks.renderer).toHaveBeenCalledWith(
      expect.objectContaining({ isLoading: false }),
      undefined
    )
  })
  it('isolates conversation state when switching cached chats', async () => {
    mocks.chat.mockReturnValue({
      messages: [],
      isChatHistoryPending: false,
      sendMessage: mocks.send,
    })
    mocks.renderer.mockImplementation(({ composer }: { composer: ReactNode }) => composer)
    await act(async () => root.render(<OrganizationHome chatId='chat-a' />))
    await act(async () => composerProps().onChange('A draft for chat A'))
    await act(async () => root.render(<OrganizationHome chatId='chat-a' />))
    expect(composerProps().value).toBe('A draft for chat A')
    await act(async () => root.render(<OrganizationHome chatId='chat-b' />))
    expect(composerProps().value).toBe('')
    expect(mocks.chat).toHaveBeenLastCalledWith({ organizationId: 'organization-a' }, 'chat-b')
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('preserves the conversation when the first send adopts a chat ID', async () => {
    mocks.renderer.mockImplementation(({ composer }: { composer: ReactNode }) => composer)
    await act(async () => root.render(<OrganizationHome />))
    await act(async () => composerProps().onChange('A follow-up draft'))
    mocks.chat.mockReturnValue({
      messages: [{ id: 'message-a', role: 'user', content: 'First question' }],
      resolvedChatId: 'chat-a',
      isChatHistoryPending: true,
      isSending: true,
      sendMessage: mocks.send,
    })
    await act(async () => root.render(<OrganizationHome />))
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
        organization: { id: 'organization-a' },
        searchAccess: { memberScoped: true },
        viewer: { isAdmin, canUseSearchMcp: true },
      })
      await act(async () => root.render(<OrganizationHome />))
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
    await act(async () => root.render(<OrganizationHome />))
    expect(hasCompletedMcpStep()).toBe(false)
    expect(mocks.apiKeys).not.toHaveBeenCalled()
  })

  it('hides MCP onboarding and stops authorization paging when organization policy blocks access', async () => {
    mocks.context.mockReturnValue({
      organization: { id: 'organization-a' },
      searchAccess: { memberScoped: true },
      viewer: { isAdmin: false, canUseSearchMcp: false },
    })
    mockAuthorizedApps([{ apps: [], nextCursor: 'older-apps' }])
    await act(async () => root.render(<OrganizationHome />))
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
    await act(async () => root.render(<OrganizationHome />))
    expect(hasCompletedMcpStep()).toBe(completed)
  })

  it('finds a Search authorization after the first page and stops paging once found', async () => {
    const firstPage = {
      apps: [authorizedApp(['offline_access'], 'other-client')],
      nextCursor: 'older-apps',
    }
    mockAuthorizedApps([firstPage])
    await act(async () => root.render(<OrganizationHome />))
    expect(hasCompletedMcpStep()).toBe(false)
    expect(mocks.fetchNextPage).toHaveBeenCalledTimes(1)

    mockAuthorizedApps([
      firstPage,
      { apps: [authorizedApp(['search:read'])], nextCursor: 'even-older-apps' },
    ])
    await act(async () => root.render(<OrganizationHome />))
    expect(hasCompletedMcpStep()).toBe(true)
    expect(mocks.fetchNextPage).toHaveBeenCalledTimes(1)
  })

  it.each([{ isFetching: true }, { isError: true }])(
    'does not start another authorization page request while %j',
    async (state) => {
      mockAuthorizedApps([{ apps: [], nextCursor: 'older-apps' }], state)
      await act(async () => root.render(<OrganizationHome />))
      expect(mocks.fetchNextPage).not.toHaveBeenCalled()
      expect(hasCompletedMcpStep()).toBe(false)
    }
  )

  it('clears MCP completion when the Search authorization is revoked', async () => {
    mockAuthorizedApps([{ apps: [authorizedApp(['search:read'])], nextCursor: null }])
    await act(async () => root.render(<OrganizationHome />))
    expect(hasCompletedMcpStep()).toBe(true)

    mockAuthorizedApps([{ apps: [], nextCursor: null }])
    await act(async () => root.render(<OrganizationHome />))
    expect(hasCompletedMcpStep()).toBe(false)
  })

  it('sends the member question as an assistant turn and clears the draft', async () => {
    await act(async () => root.render(<OrganizationHome />))
    await act(async () => composerProps().onChange('Find our launch plan'))
    await act(async () => composerProps().onSubmit())
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(
      'Find our launch plan',
      undefined,
      undefined,
      { requestMode: 'assistant' }
    )
    expect(composerProps().value).toBe('')
  })
  it('ignores a blank submission', async () => {
    await act(async () => root.render(<OrganizationHome />))
    await act(async () => composerProps().onChange('   '))
    await act(async () => composerProps().onSubmit())
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('sends image-only turns with canonical attachment properties and clears the draft', async () => {
    await act(async () => root.render(<OrganizationHome />))
    const files = [new File(['image'], 'screenshot.png', { type: 'image/png' })]
    await act(async () =>
      composerProps().files.processFiles(
        Object.assign(files, { item: (index: number) => files[index] ?? null })
      )
    )
    await act(async () => composerProps().onSubmit())
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
      messages: [],
      sendMessage: mocks.send,
      editQueuedMessage: () => ({
        id: 'queued-a',
        content: 'Explain this',
        fileAttachments: attachments,
      }),
    })
    await act(async () => root.render(<OrganizationHome chatId='chat-a' />))
    await act(async () => mocks.renderer.mock.lastCall![0].onEditQueuedMessage('queued-a'))
    expect(composerProps().files.attachedFiles[0]).toEqual(
      expect.objectContaining({
        name: 'screenshot.png',
        key: 'image-key',
        uploading: false,
        path: '/api/files/serve/image-key?context=mothership&preview=1',
      })
    )
    await act(async () => composerProps().onSubmit())
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
    await act(async () => root.render(<OrganizationHome />))
    expect(mocks.send).toHaveBeenCalledWith('', attachments, undefined, {
      requestMode: 'assistant',
    })
  })
  it('resumes a scoped handoff with the original search filters', async () => {
    const assistantSearch = { documentIds: ['document-a'] }
    mocks.consume.mockReturnValueOnce({ message: 'Summarize', assistantSearch })
    await act(async () => root.render(<OrganizationHome />))
    expect(mocks.consume).toHaveBeenCalledWith({ organizationId: 'organization-a' })
    expect(mocks.send).toHaveBeenCalledWith('Summarize', undefined, undefined, {
      requestMode: 'assistant',
      assistantSearch,
    })
  })
})
