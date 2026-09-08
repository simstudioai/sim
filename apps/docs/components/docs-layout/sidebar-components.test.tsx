/** @vitest-environment jsdom */
import { act, type ComponentProps, createElement, type ReactNode } from 'react'
import type { Folder } from 'fumadocs-core/page-tree'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarFolder, SidebarItem } from '@/components/docs-layout/sidebar-components'

const navigation = vi.hoisted(() => ({ pathname: '/search', open: false, setOpen: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }))
vi.mock('fumadocs-ui/components/sidebar/base', () => ({
  useSidebar: () => ({ prefetch: false, open: navigation.open, setOpen: navigation.setOpen }),
}))
vi.mock('@sim/emcn', () => ({
  cn: vi.fn(() => ''),
  ChipLink: ({
    active: _active,
    fullWidth: _fullWidth,
    prefetch: _prefetch,
    rightAdornment,
    children,
    onNavigate,
    ...props
  }: ComponentProps<'a'> & {
    active?: boolean
    fullWidth?: boolean
    prefetch?: boolean
    rightAdornment?: ReactNode
    onNavigate?: (event: { preventDefault: () => void }) => void
  }) =>
    createElement(
      'a',
      {
        ...props,
        onClick: (event) => {
          event.preventDefault()
          if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey)
            onNavigate?.({ preventDefault: vi.fn() })
        },
      },
      children,
      rightAdornment
    ),
  Chip: ({
    fullWidth: _fullWidth,
    rightAdornment,
    children,
    ...props
  }: ComponentProps<'button'> & {
    fullWidth?: boolean
    rightAdornment?: ReactNode
  }) => createElement('button', { type: 'button', ...props }, children, rightAdornment),
}))
vi.mock('@sim/emcn/icons', () => ({
  ChevronRight: (props: ComponentProps<'svg'>) => createElement('svg', props),
}))

const airtable: Folder = {
  type: 'folder',
  name: 'Airtable',
  index: { type: 'page', name: 'Airtable', url: '/integrations/airtable' },
  children: [
    { type: 'page', name: 'Personal Access Tokens', url: '/integrations/airtable-service-account' },
  ],
}
let container: HTMLDivElement
let root: Root
function renderFolder(item: Folder = airtable) {
  act(() =>
    root.render(
      <SidebarFolder item={item}>
        <a href='/guide'>Guide</a>
      </SidebarFolder>
    )
  )
}
function row() {
  return container.querySelector<HTMLElement>('[aria-expanded]')!
}
function clickRow() {
  act(() => row().click())
  return row()
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  navigation.pathname = '/search'
  navigation.open = false
  navigation.setOpen.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('sidebar navigation', () => {
  it('uses one overview link and chevron with no separate button or duplicate children', () => {
    renderFolder()
    expect(row().getAttribute('href')).toBe('/integrations/airtable')
    expect(row().querySelector('svg')).not.toBeNull()
    expect(container.querySelector('button')).toBeNull()
    expect(row().getAttribute('aria-expanded')).toBe('false')
    const content = document.getElementById(row().getAttribute('aria-controls')!)!
    expect(content.querySelectorAll('a')).toHaveLength(1)
    expect(content.hasAttribute('inert')).toBe(true)
    expect(content.getAttribute('aria-hidden')).toBe('true')
    navigation.pathname = '/integrations/airtable'
    renderFolder()
    expect(content.hasAttribute('inert')).toBe(false)
    expect(content.getAttribute('aria-hidden')).toBe('false')
  })

  it('opens canonical ancestors for a guide without nested URL segments', () => {
    navigation.pathname = '/integrations/airtable-service-account'
    renderFolder()
    expect(row().getAttribute('aria-expanded')).toBe('true')
    expect(row().hasAttribute('aria-current')).toBe(false)
    renderFolder({ type: 'folder', name: 'Integrations', children: [airtable] })
    expect(row().getAttribute('aria-expanded')).toBe('true')
  })

  it('does not open an unrelated section based on a relocated guide URL prefix', () => {
    navigation.pathname = '/workflows/blocks/logs'
    renderFolder({
      type: 'folder',
      name: 'Integrations',
      children: [
        {
          type: 'folder',
          name: 'Logs',
          index: { type: 'page', name: 'Logs', url: '/integrations/logs' },
          children: [{ type: 'page', name: 'Using Logs in Workflows', url: navigation.pathname }],
        },
      ],
    })
    expect(row().getAttribute('aria-expanded')).toBe('true')
    renderFolder({
      type: 'folder',
      name: 'Workflows',
      index: { type: 'page', name: 'Workflows', url: '/workflows' },
      children: [{ type: 'page', name: 'Core Blocks', url: '/workflows/blocks' }],
    })
    expect(row().getAttribute('aria-expanded')).toBe('false')
  })

  it('toggles the current overview from the same row, including its chevron', () => {
    navigation.pathname = '/integrations/airtable'
    renderFolder()
    expect(row().getAttribute('aria-current')).toBe('page')
    expect(clickRow().getAttribute('aria-expanded')).toBe('false')
    act(() =>
      row()
        .querySelector('svg')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    )
    expect(row().getAttribute('aria-expanded')).toBe('true')
  })

  it('preserves open-in-new-tab clicks without toggling the folder', () => {
    navigation.pathname = '/integrations/airtable'
    renderFolder()
    act(() =>
      row().dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true })
      )
    )
    expect(row().getAttribute('aria-expanded')).toBe('true')
  })

  it('clears manual expansion on navigation so back navigation opens the active section', () => {
    navigation.pathname = '/integrations/airtable'
    renderFolder()
    expect(clickRow().getAttribute('aria-expanded')).toBe('false')
    navigation.pathname = '/files'
    renderFolder()
    navigation.pathname = '/integrations/airtable'
    renderFolder()
    expect(row().getAttribute('aria-expanded')).toBe('true')
  })

  it('closes the mobile drawer on same-page navigation', () => {
    navigation.open = true
    navigation.pathname = '/integrations/airtable'
    renderFolder()
    clickRow()
    expect(navigation.setOpen).toHaveBeenCalledWith(false)
    expect(row().getAttribute('aria-expanded')).toBe('true')
  })

  it('renders an overview-only folder as a single link without disclosure semantics', () => {
    navigation.pathname = '/integrations/airtable'
    act(() =>
      root.render(<SidebarFolder item={{ ...airtable, children: [] }}>{null}</SidebarFolder>)
    )
    expect(container.querySelectorAll('a')).toHaveLength(1)
    expect(container.querySelector('[aria-expanded],button')).toBeNull()
    expect(container.querySelector('a')?.getAttribute('aria-current')).toBe('page')
  })

  it('keeps folders without an overview as native disclosure buttons', () => {
    renderFolder({ type: 'folder', name: 'Shared credential guides', children: airtable.children })
    expect(row().tagName).toBe('BUTTON')
    expect(clickRow().getAttribute('aria-expanded')).toBe('true')
  })

  it('marks only the exact current page and closes the drawer for leaf links', () => {
    const item = airtable.children[0]
    if (item.type !== 'page') throw new Error('Expected page fixture')
    navigation.pathname = item.url
    act(() => root.render(createElement(SidebarItem, { item })))
    expect(container.querySelector('a')?.getAttribute('aria-current')).toBe('page')
    act(() => container.querySelector('a')!.click())
    expect(navigation.setOpen).toHaveBeenCalledWith(false)
    navigation.pathname = `${item.url}/other`
    act(() => root.render(createElement(SidebarItem, { item })))
    expect(container.querySelector('a')?.getAttribute('aria-current')).toBeNull()
  })
})
