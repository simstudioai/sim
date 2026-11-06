/**
 * @vitest-environment jsdom
 *
 * The real conversation hook and the real composer, with only the chat engine and the thread's layout
 * stubbed. Failure modes: a keystroke re-rendering the thread, and a queued message coming back
 * without its text, its chips, its attachments, or the viewer's focus once the conversation no longer
 * holds the draft.
 */

import { act, type ReactNode } from 'react'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import {
  createMockDeploymentShape,
  deploymentShapeMock,
  deploymentShapeMockFns,
} from '@sim/testing/mocks/deployment-shape.mock'
import { featureFlagsProviderMock } from '@sim/testing/mocks/feature-flags-provider.mock'
import { integrationMatcherMock } from '@sim/testing/mocks/integration-matcher.mock'
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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useMothershipDraftsStore } from '@/stores/mothership-drafts/store'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  editQueued: vi.fn(),
  speech: vi.fn(),
}))

vi.mock('@/lib/auth/client', () => authClientMock)
vi.mock('@/lib/core/config/deployment-shape', () => deploymentShapeMock)
vi.mock('@/blocks/integration-matcher', () => integrationMatcherMock)
vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => organizationProviderMock)
vi.mock(
  '@/app/workspace/[workspaceId]/providers/feature-flags-provider',
  () => featureFlagsProviderMock
)
vi.mock('@/app/workspace/[workspaceId]/home/hooks/use-chat', () => useChatMock)
vi.mock('@/app/workspace/[workspaceId]/home/hooks/use-resource-panel', () => useResourcePanelMock)
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/chat-resource-panel',
  () => chatResourcePanelMock
)
vi.mock('@/app/workspace/[workspaceId]/home/components/mothership-chat', () => mothershipChatMock)
vi.mock('@/components/assistant-actions', () => ({
  AssistantActionReviewProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/user-input/components/plus-menu-dropdown/plus-menu-dropdown',
  async () => {
    const { forwardRef, useImperativeHandle } = await import('react')
    return {
      PlusMenuDropdown: forwardRef((_props, ref) => {
        useImperativeHandle(ref, () => ({
          open: vi.fn(),
          close: vi.fn(),
          moveActive: vi.fn(),
          selectActive: () => 'empty',
        }))
        return null
      }),
    }
  }
)
vi.mock('@/hooks/queries/mothership-chats', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...mothershipChatsQueriesMock,
  useMothershipChatHistory: () => ({ data: undefined }),
  useSetMothershipChatEffort: () => ({ mutate: vi.fn() }),
}))
vi.mock('@/hooks/queries/workspace', () => ({
  useWorkspacesQuery: () => ({ data: [] }),
}))
vi.mock('@/hooks/queries/mcp', () => ({ useMcpToolServers: () => ({ data: [] }) }))
vi.mock('@/hooks/use-speech-to-text', () => ({ useSpeechToText: mocks.speech }))
vi.mock('@/hooks/use-chat-input-focus', () => ({ useChatInputFocus: vi.fn() }))
vi.mock('@/hooks/use-animated-placeholder', () => ({ useAnimatedPlaceholder: () => 'Ask Sim to' }))

import { PageConversation } from '@/platform/app/(shell)/_components/conversation/page-conversation'

const { mockMothershipChat, mockUseChat } = organizationConversationMockFns

/** The editor swaps a chipped skill's `/` for a wide sentinel so its icon fits the overlay. */
const QUEUED_AS_EDITED = 'Run \u2003review on this'
const QUEUED = {
  id: 'queued-1',
  content: 'Run /review on this',
  contexts: [{ kind: 'skill', skillId: 'skill-a', label: 'review', workspaceId: 'workspace-a' }],
  fileAttachments: [
    {
      id: 'file-1',
      key: 'uploads/file-1',
      filename: 'notes.pdf',
      media_type: 'application/pdf',
      size: 12,
      path: '/files/notes.pdf',
    },
  ],
}

let root: Root
let container: HTMLDivElement
let queryClient: QueryClient

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubResizeObserver()
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  )
  HTMLElement.prototype.scrollIntoView = vi.fn()
  useMothershipDraftsStore.setState({ drafts: {} })
  const deploymentShape = () => createMockDeploymentShape()
  deploymentShapeMockFns.mockUseDeploymentShape.mockImplementation(deploymentShape)
  deploymentShapeMockFns.mockGetDeploymentShape.mockImplementation(deploymentShape)
  nextNavigationMockFns.mockUsePathname.mockReturnValue('/o/organization-a/chat/chat-a')
  authClientMockFns.mockUseSession.mockReturnValue({ data: { user: { id: 'reader' } } })
  organizationProviderMockFns.mockUseOrganizationContext.mockReturnValue({
    organization: { id: 'organization-a', name: 'Acme' },
    searchAccess: { memberScoped: true },
    mothershipAvailable: true,
    canBuild: true,
  })
  mocks.speech.mockReturnValue({
    isSupported: false,
    isListening: false,
    audioLevels: new Float32Array(5),
    toggleListening: vi.fn(),
    resetTranscript: vi.fn(),
  })
  mocks.editQueued.mockReturnValue(QUEUED)
  mockUseChat.mockReturnValue({
    messages: [{ id: 'message-1', role: 'user', content: 'Earlier' }],
    messageQueue: [QUEUED],
    resources: [],
    resolvedChatId: 'chat-a',
    isChatHistoryPending: false,
    sendMessage: mocks.send,
    editQueuedMessage: mocks.editQueued,
  })
  mockMothershipChat.mockImplementation(({ composer }: { composer: ReactNode }) => composer)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <NuqsTestingAdapter hasMemory>
          <PageConversation chatId='chat-a' requestMode='agent' fallback={null} />
        </NuqsTestingAdapter>
      </QueryClientProvider>
    )
  )
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  queryClient.clear()
})

function field() {
  const input = container.querySelector<HTMLTextAreaElement>('[aria-label="Ask Sim"]')
  if (!input) throw new Error('The composer has not rendered')
  return input
}

function typeInto(input: HTMLTextAreaElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(input, text)
  input.setSelectionRange(text.length, text.length)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function savedDraft() {
  return useMothershipDraftsStore.getState().drafts['reader:organization:organization-a:chat-a']
}

it('a keystroke reaches the draft without re-rendering the thread', async () => {
  const rendersBefore = mockMothershipChat.mock.calls.length
  const chatRendersBefore = mockUseChat.mock.calls.length
  await act(async () => typeInto(field(), 'a'))
  await act(async () => typeInto(field(), 'ab'))
  await act(async () => typeInto(field(), 'abc'))
  expect(field().value).toBe('abc')
  expect(savedDraft()?.text).toBe('abc')
  expect(mockMothershipChat.mock.calls.length).toBe(rendersBefore)
  expect(mockUseChat.mock.calls.length).toBe(chatRendersBefore)
})

it('recalling the queued tail brings back its text, chips, attachments, and focus', async () => {
  const input = field()
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
  )
  expect(mocks.editQueued).toHaveBeenCalledExactlyOnceWith('queued-1')
  expect(field().value).toBe(QUEUED_AS_EDITED)
  expect(document.activeElement).toBe(field())
  expect(savedDraft()?.text).toBe(QUEUED.content)
  expect(savedDraft()?.contexts).toEqual(QUEUED.contexts)
  expect(container.textContent).toContain('notes.pdf')
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')?.click()
  )
  expect(mocks.send).toHaveBeenCalledExactlyOnceWith(
    QUEUED.content,
    [expect.objectContaining({ key: 'uploads/file-1', filename: 'notes.pdf' })],
    QUEUED.contexts,
    expect.objectContaining({ requestMode: 'agent' })
  )
  expect(field().value).toBe('')
  expect(savedDraft()).toBeUndefined()
})

it('the thread restoring a queued message over a typed draft replaces it', async () => {
  await act(async () => typeInto(field(), 'half a thought'))
  const { onEditQueuedMessage } = mockMothershipChat.mock.lastCall?.[0] ?? {}
  await act(async () => onEditQueuedMessage('queued-1'))
  expect(field().value).toBe(QUEUED_AS_EDITED)
  expect(savedDraft()?.contexts).toEqual(QUEUED.contexts)
  expect(document.activeElement).toBe(field())
})

it('a draft cleared from outside empties the editor and its chips', async () => {
  await act(async () => typeInto(field(), 'stale question'))
  await act(async () =>
    useMothershipDraftsStore.getState().clearDraft('reader:organization:organization-a:chat-a')
  )
  expect(field().value).toBe('')
  expect(savedDraft()).toBeUndefined()
})
