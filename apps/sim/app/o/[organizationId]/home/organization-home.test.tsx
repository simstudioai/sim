/** @vitest-environment jsdom */
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  chat: vi.fn(),
  composer: vi.fn(),
  renderer: vi.fn(),
  setParams: vi.fn(),
  markRead: vi.fn(),
  send: vi.fn(),
  consume: vi.fn(),
}))
vi.mock('nuqs', () => ({
  parseAsString: { withDefault: () => ({}) },
  parseAsStringLiteral: () => ({ withDefault: () => ({}) }),
  useQueryStates: () => [{ mode: 'assistant', q: '' }, mocks.setParams],
}))
vi.mock('@/app/workspace/[workspaceId]/home/search-params', () => ({ searchFilterParsers: {} }))
vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'reader' } } }),
}))
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
vi.mock('@/app/workspace/[workspaceId]/home/components/mothership-chat', () => ({
  MothershipChat: mocks.renderer,
}))
vi.mock('@/app/workspace/[workspaceId]/home/components/knowledge-search-results', () => ({
  KnowledgeSearchResults: () => null,
}))

import type { Composer } from '@/app/o/[organizationId]/home/components/composer'
import { OrganizationHome } from '@/app/o/[organizationId]/home/organization-home'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.context.mockReturnValue({
    organization: { id: 'organization-a' },
    viewer: { isAdmin: false },
  })
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

describe('organization home', () => {
  it('renders a usable composer when the disabled history query is pending', async () => {
    await act(async () => root.render(<OrganizationHome />))
    expect(container.textContent).toContain('Question composer')
    expect(container.textContent).toContain('Connect your accounts')
    expect(mocks.renderer).not.toHaveBeenCalled()
    expect(mocks.chat).toHaveBeenCalledWith({ organizationId: 'organization-a' }, undefined)
  })
  it('keeps history loading scoped to an actual routed chat', async () => {
    await act(async () => root.render(<OrganizationHome chatId='chat-a' />))
    expect(mocks.renderer).toHaveBeenCalledWith(
      expect.objectContaining({ isLoading: true }),
      undefined
    )
    expect(mocks.consume).not.toHaveBeenCalled()
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
