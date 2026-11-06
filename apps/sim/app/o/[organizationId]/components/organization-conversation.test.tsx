/** @vitest-environment jsdom */

import { act, type ReactNode } from 'react'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import {
  createMockDeploymentShape,
  deploymentShapeMock,
  deploymentShapeMockFns,
} from '@sim/testing/mocks/deployment-shape.mock'
import {
  featureFlagsProviderMock,
  featureFlagsProviderMockFns,
} from '@sim/testing/mocks/feature-flags-provider.mock'
import { integrationMatcherMock } from '@sim/testing/mocks/integration-matcher.mock'
import { kbConnectorsQueriesMock } from '@sim/testing/mocks/kb-connectors-queries.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
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
import { toRecord } from '@sim/utils/object'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizedAppsPage } from '@/lib/api/contracts/user'
import { readDraft, useMothershipDraftsStore } from '@/stores/mothership-drafts/store'

const mocks = vi.hoisted(() => ({
  plan: false,
  composer: vi.fn(),
  send: vi.fn(),
  apiKeys: vi.fn(),
  authorizedApps: vi.fn(),
  fetchNextPage: vi.fn(),
  upload: vi.fn(),
  addResource: vi.fn(),
  selectResource: vi.fn(),
  activeResource: null as string | null,
}))
vi.mock(
  '@/app/workspace/[workspaceId]/providers/feature-flags-provider',
  () => featureFlagsProviderMock
)
vi.mock('@/lib/core/config/deployment-shape', () => deploymentShapeMock)
vi.mock('@/blocks/integration-matcher', () => integrationMatcherMock)
vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@tanstack/react-query', () => reactQueryMock)
vi.mock('@/app/workspace/[workspaceId]/home/hooks/use-resource-panel', () => useResourcePanelMock)
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/chat-resource-panel',
  () => chatResourcePanelMock
)
vi.mock('@/lib/auth/client', () => authClientMock)
vi.mock('@/lib/uploads/client/session-upload', () => ({ uploadInternalFileSession: mocks.upload }))
vi.mock('@/lib/organizations/provider', () => organizationProviderMock)
vi.mock('@/app/workspace/[workspaceId]/home/hooks/use-chat', () => useChatMock)
vi.mock('@/hooks/queries/mothership-chats', () => mothershipChatsQueriesMock)
vi.mock('@/platform/embedded/app/(shell)/_components/conversation/page-composer', () => ({
  PageComposer: mocks.composer,
}))
vi.mock('@/hooks/queries/kb/connectors', () => kbConnectorsQueriesMock)
vi.mock('@/hooks/queries/api-keys', () => ({ useApiKeys: mocks.apiKeys }))
vi.mock('@/hooks/queries/oauth-provider', () => ({ useAuthorizedApps: mocks.authorizedApps }))
vi.mock('@/app/workspace/[workspaceId]/home/components/mothership-chat', () => mothershipChatMock)
vi.mock('@/app/extension/o/[organizationId]/panel-composer', () => ({ PanelComposer: () => null }))

import { PanelConversation } from '@/app/extension/o/[organizationId]/panel-conversation'
import type { ConversationComposerProps } from '@/app/o/[organizationId]/home/components/composer'
import { PageConversation } from '@/platform/embedded/app/(shell)/_components/conversation/page-conversation'

const {
  mockMothershipChat,
  mockUseChat,
  mockUseChatResourcePanel,
  mockUseResourcePanelController,
} = organizationConversationMockFns

const mockSession = authClientMockFns.mockUseSession
const mockContext = organizationProviderMockFns.mockUseOrganization
const deploymentShape = () => createMockDeploymentShape()
deploymentShapeMockFns.mockUseDeploymentShape.mockImplementation(deploymentShape)
deploymentShapeMockFns.mockGetDeploymentShape.mockImplementation(deploymentShape)

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  reactQueryMockFns.mockUseQuery.mockReturnValue(createQueryResultMock())
  reactQueryMockFns.mockUseMutation.mockReturnValue(createMutationResultMock())
  useMothershipDraftsStore.setState({ drafts: {} })
  mocks.plan = false
  featureFlagsProviderMockFns.mockUseFeatureFlag.mockImplementation(
    (name: string) => name === 'mothership-plan-mode' && mocks.plan
  )
  mocks.activeResource = null
  mockSession.mockReturnValue({ data: { user: { id: 'reader' } } })
  mockUseResourcePanelController.mockImplementation(() => ({
    onResourceEvent: undefined,
    activeResourceState: undefined,
    activeResourceParam: mocks.activeResource,
    setActiveResourceUrl: mocks.selectResource,
  }))
  mockUseChatResourcePanel.mockImplementation(() => ({
    isResourceCollapsed: true,
    addResourceFromUser: mocks.addResource,
    prepareResourceViewForAgentTurn: vi.fn(),
  }))
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:image-preview')
      static revokeObjectURL = vi.fn()
    }
  )
  mocks.upload.mockResolvedValue({ key: 'image-key', path: '/image-path' })
  mockContext.mockReturnValue({
    organization: { id: 'organization-a', name: 'Acme' },
    searchAccess: { memberScoped: true },
    mothershipAvailable: true,
    canBuild: true,
    viewer: { userId: 'reader', isAdmin: false, canUseSearchMcp: true },
  })
  mocks.apiKeys.mockReturnValue({ data: { personalKeys: [] } })
  mockAuthorizedApps([{ apps: [], nextCursor: null }])
  mockUseChat.mockReturnValue({
    messages: [],
    resources: [],
    isChatHistoryPending: true,
    sendMessage: mocks.send,
  })

  mocks.composer.mockReturnValue(<div>Question composer</div>)
  mockMothershipChat.mockReturnValue(<div>Chat history</div>)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
function renderHome(element: ReactNode, searchParams = '') {
  root.render(
    <NuqsTestingAdapter hasMemory searchParams={searchParams}>
      {element}
    </NuqsTestingAdapter>
  )
}
function composerProps(): ConversationComposerProps {
  const call = mocks.composer.mock.lastCall
  if (!call) throw new Error('Composer has not rendered')
  return call[0]
}

function draftText() {
  return (
    readDraft(useMothershipDraftsStore.getState().drafts, composerProps().draftKeys)?.text ?? ''
  )
}

function writeDraft(text: string) {
  const store = useMothershipDraftsStore.getState()
  const [key] = composerProps().draftKeys
  store.setDraft(key, { ...store.drafts[key], text })
}

async function attachDraftImage() {
  const files = [new File(['image'], 'draft.png', { type: 'image/png' })]
  await act(async () =>
    composerProps().files.processFiles(
      Object.assign(files, { item: (index: number) => files[index] ?? null })
    )
  )
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
  it('isolates conversation state when switching cached chats', async () => {
    mockUseChat.mockReturnValue({
      resources: [],
      messages: [],
      isChatHistoryPending: false,
      sendMessage: mocks.send,
    })
    mockMothershipChat.mockImplementation(({ composer }: { composer: ReactNode }) => composer)
    await act(async () =>
      renderHome(<PageConversation requestMode='agent' chatId='chat-a' fallback={null} />)
    )
    await act(async () => writeDraft('A draft for chat A'))
    await act(async () =>
      renderHome(<PageConversation requestMode='agent' chatId='chat-a' fallback={null} />)
    )
    expect(draftText()).toBe('A draft for chat A')
    await act(async () =>
      renderHome(<PageConversation requestMode='agent' chatId='chat-b' fallback={null} />)
    )
    expect(draftText()).toBe('')
    expect(mockUseChat).toHaveBeenLastCalledWith(
      { organizationId: 'organization-a' },
      'chat-b',
      expect.objectContaining({
        requestMode: 'agent',
      })
    )
    expect(mocks.send).not.toHaveBeenCalled()
  })
})

it('isolates saved drafts by user, organization, and conversation', async () => {
  mockMothershipChat.mockImplementation(({ composer }: { composer: ReactNode }) => composer)
  await act(async () =>
    renderHome(<PageConversation chatId='chat-a' requestMode='assistant' fallback={null} />)
  )
  await attachDraftImage()
  await act(async () => writeDraft('Chat A follow-up'))
  await act(async () =>
    renderHome(<PageConversation chatId='chat-b' requestMode='assistant' fallback={null} />)
  )
  expect(draftText()).toBe('')
  await act(async () =>
    renderHome(<PageConversation chatId='chat-a' requestMode='assistant' fallback={null} />)
  )
  expect(draftText()).toBe('Chat A follow-up')
  expect(composerProps().files.attachedFiles[0]?.key).toBe('image-key')
  const reader = toRecord(mockContext())
  mockContext.mockReturnValue({
    ...reader,
    viewer: { ...toRecord(reader.viewer), userId: 'other-user' },
  })
  await act(async () =>
    renderHome(<PageConversation chatId='chat-a' requestMode='assistant' fallback={null} />)
  )
  expect(draftText()).toBe('')
  mockContext.mockReturnValue(reader)
  mockContext.mockReturnValue({
    ...toRecord(mockContext()),
    organization: { id: 'other-org', name: 'Other' },
  })
  await act(async () =>
    renderHome(<PageConversation chatId='chat-a' requestMode='assistant' fallback={null} />)
  )
  expect(draftText()).toBe('')
})

describe('a message not delivered', () => {
  const surfaces: Array<[string, () => ReactNode]> = [
    [
      'organization page',
      () => <PageConversation chatId='chat-a' requestMode='assistant' fallback={null} />,
    ],
    [
      'extension panel',
      () => (
        <PanelConversation
          chatId='chat-a'
          requestMode='assistant'
          header={null}
          onChatIdResolved={vi.fn()}
          onNavigateToChat={vi.fn()}
          prepareSubmission={vi.fn()}
          onSubmitted={vi.fn()}
          draftNamespace='extension'
        />
      ),
    ],
  ]

  it.each(surfaces)(
    'offers Retry and Dismiss that reach the chat on the %s',
    async (_name, view) => {
      const retryMessage = vi.fn()
      const dismissMessage = vi.fn()
      mockUseChat.mockReturnValue({
        resources: [],
        messages: [{ id: 'held', role: 'user', content: 'Then summarize', delivery: 'failed' }],
        isChatHistoryPending: false,
        resolvedChatId: 'chat-a',
        sendMessage: mocks.send,
        retryMessage,
        dismissMessage,
      })

      await act(async () => renderHome(view()))

      const thread = toRecord(mockMothershipChat.mock.lastCall?.[0])
      const { onRetryMessage, onDismissMessage } = thread
      if (typeof onRetryMessage !== 'function' || typeof onDismissMessage !== 'function') {
        throw new Error('The thread renders a message not delivered with no Retry or Dismiss')
      }
      onRetryMessage('held')
      onDismissMessage('held')
      expect(retryMessage).toHaveBeenCalledWith('held')
      expect(dismissMessage).toHaveBeenCalledWith('held')
    }
  )
})
