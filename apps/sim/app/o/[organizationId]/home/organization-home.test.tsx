/** @vitest-environment jsdom */
import { act, type ComponentProps, type ReactNode } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizedAppsPage } from '@/lib/api/contracts/user'
import { useMothershipDraftsStore } from '@/stores/mothership-drafts/store'
import { useOrganizationChatModeStore } from '@/stores/organization-chat-mode/store'

const mocks = vi.hoisted(() => ({
  live: false,
  plan: false,
  context: vi.fn(),
  session: vi.fn(),
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
  selectResource: vi.fn(),
  activeResource: null as string | null,
}))
vi.mock('@/app/workspace/[workspaceId]/providers/feature-flags-provider', () => ({
  useFeatureFlag: (name: string) => (name === 'mothership-plan-mode' ? mocks.plan : false),
}))
vi.mock('@/lib/core/config/deployment-shape', () => ({
  useDeploymentShape: () => ({
    features: { liveEnterpriseSearch: mocks.live },
  }),
  getDeploymentShape: () => ({ features: { liveEnterpriseSearch: mocks.live } }),
}))
vi.mock('@/blocks/integration-matcher', () => ({ mentionifyIntegrations: (text: string) => text }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ fetchQuery: vi.fn() }) }))
vi.mock('@/app/workspace/[workspaceId]/home/hooks/use-resource-panel', () => ({
  useResourcePanelController: () => ({
    onResourceEvent: undefined,
    activeResourceState: undefined,
    activeResourceParam: mocks.activeResource,
    setActiveResourceUrl: mocks.selectResource,
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
  useSession: mocks.session,
}))
vi.mock('@/lib/uploads/client/session-upload', () => ({ uploadInternalFileSession: mocks.upload }))
vi.mock('@/lib/core/utils/browser-storage', () => ({
  MothershipHandoffStorage: { consume: mocks.consume },
}))
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => ({
  useOrganizationContext: mocks.context,
}))
vi.mock('@/app/workspace/[workspaceId]/home/hooks/use-chat', () => ({
  getMothershipUseChatOptions: (options: object) => ({ ...options, mothership: true }),
  useChat: mocks.chat,
}))
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
  useMothershipDraftsStore.setState({ drafts: {} })
  mocks.plan = false
  mocks.live = false
  vi.clearAllMocks()
  mocks.activeResource = null
  mocks.session.mockReturnValue({ data: { user: { id: 'reader' } } })
  useOrganizationChatModeStore.setState({ modes: {}, assistantSearchLevels: {} })
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
})

it('isolates saved drafts by user, organization, and conversation', async () => {
  mocks.renderer.mockImplementation(({ composer }: { composer: ReactNode }) => composer)
  await act(async () => renderHome(<OrganizationHome chatId='chat-a' requestMode='assistant' />))
  await attachDraftImage()
  await act(async () => composerProps().onChange('Chat A follow-up'))
  await act(async () => renderHome(<OrganizationHome chatId='chat-b' requestMode='assistant' />))
  expect(composerProps().value).toBe('')
  await act(async () => renderHome(<OrganizationHome chatId='chat-a' requestMode='assistant' />))
  expect(composerProps().value).toBe('Chat A follow-up')
  expect(composerProps().files.attachedFiles[0]?.key).toBe('image-key')
  mocks.session.mockReturnValue({ data: { user: { id: 'other-user' } } })
  await act(async () => renderHome(<OrganizationHome chatId='chat-a' requestMode='assistant' />))
  expect(composerProps().value).toBe('')
  mocks.session.mockReturnValue({ data: { user: { id: 'reader' } } })
  mocks.context.mockReturnValue({
    ...mocks.context(),
    organization: { id: 'other-org', name: 'Other' },
  })
  await act(async () => renderHome(<OrganizationHome chatId='chat-a' requestMode='assistant' />))
  expect(composerProps().value).toBe('')
})
