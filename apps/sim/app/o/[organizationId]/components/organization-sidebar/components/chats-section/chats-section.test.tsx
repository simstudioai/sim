/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrganizationChat } from '@/app/o/[organizationId]/components/organization-sidebar/hooks'

const hoverState = vi.hoisted(() => ({ isOpen: false }))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
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
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function render(props: Partial<Parameters<typeof ChatsSection>[0]> = {}) {
  await act(async () => {
    root.render(
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
