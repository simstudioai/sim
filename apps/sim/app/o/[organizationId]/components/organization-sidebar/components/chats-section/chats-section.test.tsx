/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrganizationChat } from '@/app/o/[organizationId]/components/organization-sidebar/hooks'

const hoverState = vi.hoisted(() => ({ isOpen: false }))

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
vi.mock('@/app/workspace/[workspaceId]/w/components/sidebar/hooks', () => ({
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
          menuOpenHref={null}
          onContextMenu={() => {}}
          onMoreClick={() => {}}
          {...props}
        />
      </QueryClientProvider>
    )
  })
}

describe('ChatsSection', () => {
  it('lists every chat with no paging control', async () => {
    await render()

    expect(container.querySelectorAll('a[href^="/o/org-1/chat/"]')).toHaveLength(8)
    expect(container.textContent).not.toContain('See more')
  })

  it('marks the chat on the current route active', async () => {
    await render({ pathname: '/o/org-1/chat/chat-3' })

    const current = container.querySelector('a[href="/o/org-1/chat/chat-3"]')
    const other = container.querySelector('a[href="/o/org-1/chat/chat-4"]')
    expect(current?.className).toContain('surface-active')
    expect(other?.className).not.toContain('surface-active')
  })

  it('reports the row href when its options button is pressed', async () => {
    const onMoreClick = vi.fn()
    await render({ onMoreClick })

    const button = container.querySelector<HTMLButtonElement>(
      'a[href="/o/org-1/chat/chat-2"] button[aria-label="Chat options"]'
    )
    await act(async () => button?.click())

    expect(onMoreClick).toHaveBeenCalledWith(expect.anything(), '/o/org-1/chat/chat-2')
    expect(prefetchQuery).not.toHaveBeenCalled()
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
