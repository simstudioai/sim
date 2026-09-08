/** @vitest-environment jsdom */
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
}))
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
vi.mock('@/hooks/queries/kb/connectors', () => ({ useSearchSources: mocks.sources }))
vi.mock('@/hooks/queries/api-keys', () => ({ useApiKeys: mocks.apiKeys }))
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
  mocks.context.mockReturnValue({
    organization: { id: 'organization-a' },
    searchAccess: { memberScoped: true },
    viewer: { isAdmin: false },
  })
  mocks.sources.mockReturnValue({ data: [] })
  mocks.apiKeys.mockReturnValue({ data: { personalKeys: [] } })
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
  it.each([
    { isAdmin: true, integrationHref: '/o/organization-a/settings/integrations' },
    { isAdmin: false, integrationHref: '/o/organization-a/integrations' },
  ])(
    'routes onboarding for admin=$isAdmin without a workspace creation requirement',
    async ({ isAdmin, integrationHref }) => {
      mocks.context.mockReturnValue({
        organization: { id: 'organization-a' },
        searchAccess: { memberScoped: true },
        viewer: { isAdmin },
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
