/** @vitest-environment jsdom */
import { act, type ComponentProps, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocsSidebar } from '@/components/docs-layout/docs-sidebar'

const state = vi.hoisted(() => ({ mobile: false, open: false, setOpen: vi.fn() }))
vi.mock('fumadocs-core/utils/use-media-query', () => ({ useMediaQuery: () => state.mobile }))
vi.mock('fumadocs-ui/components/sidebar/base', () => ({ useSidebar: () => state }))
vi.mock('next/navigation', () => ({ usePathname: () => '/integrations/zendesk' }))
vi.mock('fumadocs-ui/contexts/tree', () => ({
  useTreeContext: () => ({
    root: {
      $id: 'docs',
      children: [{ type: 'page', name: 'Zendesk', url: '/integrations/zendesk' }],
    },
  }),
}))
vi.mock('@/components/docs-layout/sidebar-components', () => ({
  SidebarItem: ({ item }: { item: { name: string; url: string } }) =>
    createElement('a', { href: item.url, 'aria-current': 'page' }, item.name),
  SidebarFolder: ({ children }: { children: ReactNode }) => children,
  SidebarSeparator: () => null,
}))
vi.mock('@sim/emcn', () => ({
  cn: (...classes: string[]) => classes.join(' '),
  Chip: ({ leftIcon: _icon, ...props }: ComponentProps<'button'> & { leftIcon?: unknown }) =>
    createElement('button', props),
  ChipLink: ({ onNavigate, ...props }: ComponentProps<'a'> & { onNavigate?: () => void }) =>
    createElement('a', {
      ...props,
      onClick: (event) => {
        event.preventDefault()
        onNavigate?.()
      },
    }),
  useScrollEdges: () => ({ top: false, bottom: false }),
  scrollFadeAttributes: () => ({}),
  scrollFadeClass: 'scroll-fade',
}))
vi.mock('@sim/emcn/icons', () => ({ X: () => null }))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  state.mobile = false
  state.open = false
  state.setOpen.mockClear()
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function render() {
  act(() => root.render(<DocsSidebar />))
}

describe('documentation sidebar surfaces', () => {
  it('renders one desktop navigation tree', () => {
    render()
    expect(container.querySelectorAll('aside[aria-label="Documentation navigation"]')).toHaveLength(
      1
    )
    expect(container.querySelectorAll('a[aria-current="page"]')).toHaveLength(1)
    expect(container.querySelector('dialog')).toBeNull()
  })

  it('opens the mobile modal and synchronizes native dismissal', () => {
    state.mobile = true
    state.open = true
    render()
    const dialog = container.querySelector('dialog')!
    expect(dialog.open).toBe(true)
    expect(container.querySelector('aside')).toBeNull()
    expect(container.querySelectorAll('a[aria-current="page"]')).toHaveLength(1)
    act(() => dialog.dispatchEvent(new Event('close')))
    expect(state.setOpen).toHaveBeenCalledWith(false)
  })

  it('clears mobile disclosure state when resizing to desktop', () => {
    state.mobile = true
    state.open = true
    render()
    state.mobile = false
    render()
    expect(container.querySelector('dialog')).toBeNull()
    expect(state.setOpen).toHaveBeenCalledWith(false)
  })

  it('scrolls a deep selected row into view without scrolling the document', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element
    ) {
      return DOMRect.fromRect(
        this.hasAttribute('aria-current')
          ? { x: 0, y: 800, width: 250, height: 30 }
          : { x: 0, y: 0, width: 280, height: 600 }
      )
    })
    render()
    expect(container.querySelector('.scroll-fade')?.scrollTop).toBe(242)
    expect(document.documentElement.scrollTop).toBe(0)
  })
})
