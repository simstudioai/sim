/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrganizationChat } from '@/app/o/[organizationId]/components/organization-sidebar/hooks'

const hoverState = vi.hoisted(() => ({ isOpen: false }))
const mockRequestJson = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api/client/request', () => ({ requestJson: mockRequestJson }))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    prefetch: _prefetch,
    ...props
  }: {
    href: string
    children: React.ReactNode
    prefetch?: boolean
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))
vi.mock('@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-hover-menu', () => ({
  useHoverMenu: () => ({
    isOpen: hoverState.isOpen,
    open: vi.fn(),
    close: vi.fn(),
    setLocked: vi.fn(),
    triggerProps: { onMouseEnter: vi.fn(), onMouseLeave: vi.fn() },
    contentProps: { onMouseEnter: vi.fn(), onMouseLeave: vi.fn(), onCloseAutoFocus: vi.fn() },
  }),
}))

import { ChatsSection } from '@/app/o/[organizationId]/components/organization-sidebar/components/chats-section/chats-section'
import { mothershipChatKeys } from '@/hooks/queries/mothership-chats'

const CHATS: OrganizationChat[] = Array.from({ length: 8 }, (_, index) => ({
  id: `chat-${index + 1}`,
  name: `Chat ${index + 1}`,
  href: `/o/org-1/chat/chat-${index + 1}`,
}))

let container: HTMLDivElement
let root: Root
let queryClient: QueryClient
let prefetchQuery: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  vi.clearAllMocks()
  mockRequestJson.mockResolvedValue({ success: true })
  hoverState.isOpen = false
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  prefetchQuery = vi.spyOn(queryClient, 'prefetchQuery').mockResolvedValue()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  queryClient.clear()
  vi.unstubAllGlobals()
})

async function render(props: Partial<Parameters<typeof ChatsSection>[0]> = {}) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ChatsSection
          chats={CHATS}
          isLoading={false}
          isCollapsed={false}
          pathname={null}
          organizationId='org-1'
          {...props}
        />
      </QueryClientProvider>
    )
  })
}

describe('ChatsSection', () => {
  it('shows all chats without pagination controls', async () => {
    await render()
    expect(container.querySelectorAll('a[href^="/o/org-1/chat/"]')).toHaveLength(8)
    expect(container.textContent).not.toContain('See more')
    expect(container.textContent).not.toContain('See less')
  })

  it('marks the chat on the current route active', async () => {
    await render({ pathname: '/o/org-1/chat/chat-8' })

    const current = container.querySelector('a[href="/o/org-1/chat/chat-8"]')
    const other = container.querySelector('a[href="/o/org-1/chat/chat-4"]')
    expect(current?.className).toContain('surface-active')
    expect(other?.className).not.toContain('surface-active')
  })

  it.each([false, true])('renames via the options menu with collapsed=%s', async (isCollapsed) => {
    hoverState.isOpen = isCollapsed
    await render({ isCollapsed })
    const button =
      document.body.querySelector<HTMLButtonElement>(
        'a[href="/o/org-1/chat/chat-2"] button[aria-label="Chat options"]'
      ) ?? document.body.querySelector<HTMLButtonElement>('[aria-label="Chat options"]')!
    await act(async () => button.click())
    const rename = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')
    ).find((item) => item.textContent === 'Rename')!
    expect(rename).toBeDefined()
    await act(async () => rename.click())
    const input = document.body.querySelector<HTMLInputElement>('input[aria-label^="Rename chat"]')!
    expect(input).not.toBeNull()
    expect(input.value).toMatch(/^Chat /)
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'Planning'
      )
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    )
    expect(mockRequestJson).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'PATCH' }),
      expect.objectContaining({ body: { title: 'Planning' } })
    )
    expect(document.body.querySelector('input[aria-label^="Rename chat"]')).toBeNull()
  })

  it('rolls back only the organization list when rename fails', async () => {
    const pending = Promise.withResolvers<{ success: boolean }>()
    mockRequestJson.mockReturnValueOnce(pending.promise)
    const key = mothershipChatKeys.organizationList('org-1')
    queryClient.setQueryData(key, [{ id: 'chat-1', name: 'Chat 1' }])
    const workspaceKey = mothershipChatKeys.list('workspace-1')
    queryClient.setQueryData(workspaceKey, [{ id: 'workspace-chat', name: 'Workspace chat' }])
    await render()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Chat options"]')!.click()
    )
    const action = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')
    ).find((item) => item.textContent === 'Rename')!
    await act(async () => action.click())
    const input = document.body.querySelector<HTMLInputElement>('input[aria-label^="Rename chat"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'Pending title'
      )
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    )
    expect(queryClient.getQueryData(key)).toEqual([{ id: 'chat-1', name: 'Pending title' }])
    await act(async () => pending.reject(new Error('Rename rejected')))
    expect(queryClient.getQueryData(key)).toEqual([{ id: 'chat-1', name: 'Chat 1' }])
    expect(queryClient.getQueryData(workspaceKey)).toEqual([
      { id: 'workspace-chat', name: 'Workspace chat' },
    ])
    expect(input.value).toBe('Chat 1')
    expect(input.disabled).toBe(false)
  })

  it('cancels rename on Escape without a mutation', async () => {
    await render()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Chat options"]')!.click()
    )
    const rename = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')
    ).find((item) => item.textContent === 'Rename')!
    await act(async () => rename.click())
    const input = document.body.querySelector<HTMLInputElement>('input[aria-label^="Rename chat"]')!
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    )
    expect(mockRequestJson).not.toHaveBeenCalled()
    expect(document.body.querySelector('input[aria-label^="Rename chat"]')).toBeNull()
  })

  it.each([
    ['Pin', { pinned: true }],
    ['Mark as unread', { isUnread: true }],
  ])('offers %s for organization chats', async (label, body) => {
    await render()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Chat options"]')!.click()
    )
    const action = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')
    ).find((item) => item.textContent === label)!
    await act(async () => action.click())
    expect(mockRequestJson).toHaveBeenCalledWith(expect.objectContaining({ method: 'PATCH' }), {
      params: { chatId: 'chat-1' },
      body,
    })
  })

  it.each([false, true])(
    'prefetches focused destination history with collapsed=%s',
    async (isCollapsed) => {
      hoverState.isOpen = isCollapsed
      await render({ isCollapsed })
      prefetchQuery.mockClear()
      const link = document.body.querySelector<HTMLAnchorElement>('a[href="/o/org-1/chat/chat-3"]')!
      await act(async () => link.focus())
      expect(prefetchQuery).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['mothership-chats', 'detail', 'chat-3'] })
      )
    }
  )

  it('does not prefetch the active conversation', async () => {
    await render({ pathname: '/o/org-1/chat/chat-3' })
    const link = container.querySelector<HTMLAnchorElement>('a[href="/o/org-1/chat/chat-3"]')!
    await act(async () => link.focus())
    expect(prefetchQuery).not.toHaveBeenCalled()
  })

  it('shows the empty state when there are no chats', async () => {
    await render({ chats: [] })
    expect(container.textContent).toContain('No chats yet')
  })

  it('renders the flyout rows while collapsed', async () => {
    hoverState.isOpen = true
    await render({ isCollapsed: true })

    expect(container.querySelector('[aria-label="Chats"]')).not.toBeNull()
    /* Radix portals the flyout to the body. */
    expect(document.body.querySelectorAll('a[href^="/o/org-1/chat/"]')).toHaveLength(8)
  })
})
