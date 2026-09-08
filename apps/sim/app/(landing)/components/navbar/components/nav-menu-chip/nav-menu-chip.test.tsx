/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NAV_MENUS } from '@/app/(landing)/components/navbar/components/nav-menu-chip/constants'
import { NavMenuCluster } from '@/app/(landing)/components/navbar/components/nav-menu-chip/nav-menu-chip'
import type { NavMenuItemData } from '@/app/(landing)/components/navbar/components/nav-menu-chip/types'

const { frost, setMenuOpen } = vi.hoisted(() => {
  const setMenuOpen = vi.fn()
  return { frost: { setMenuOpen }, setMenuOpen }
})

vi.mock('@sim/emcn', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  chipVariants: () => '',
  chipContentLabelClass: '',
  ChipChevronDown: () => null,
  ChipTag: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))
vi.mock('next/link', () => ({
  default: ({ prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean | null }) => (
    <a {...props} data-prefetch={prefetch === false ? 'disabled' : 'auto'} />
  ),
}))
vi.mock('@/app/(landing)/components/chevron-arrow', () => ({
  ChevronArrow: () => null,
}))
vi.mock('@/app/(landing)/components/navbar/components/sim-wordmark', () => ({
  SimWordmark: () => null,
}))
vi.mock('@/app/(landing)/components/navbar/components/navbar-shell', () => ({
  NAVBAR_GLASS_SURFACE: '',
  useNavbarFrost: () => frost,
}))
vi.mock(
  '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-card',
  () => ({ NavMenuCard: () => null })
)
vi.mock(
  '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-logo-marquee',
  () => ({ NavMenuLogoMarquee: () => null })
)
vi.mock(
  '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/nav-menu-preview',
  () => ({
    NavMenuPreview: ({ item }: { item: NavMenuItemData }) => (
      <output aria-label='Feature preview'>{item.preview.kind}</output>
    ),
  })
)

let host: HTMLDivElement
let root: Root
let desktopMedia: EventTarget & { matches: boolean }

beforeEach(() => {
  setMenuOpen.mockClear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  desktopMedia = Object.assign(new EventTarget(), { matches: true })
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => desktopMedia)
  )
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root.render(<NavMenuCluster menus={NAV_MENUS} />))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

function element(selector: string): HTMLElement {
  const result = host.querySelector<HTMLElement>(selector)
  if (!result) throw new Error(`Missing navigation element: ${selector}`)
  return result
}

function hover(target: HTMLElement) {
  act(() => {
    target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  })
}

function expectSelected(href: string, kind: string) {
  const panel = element('#primary-navigation-mega-menu')
  expect(panel.getAttribute('aria-hidden')).toBe('false')
  const activeLinks = panel.querySelectorAll('a[data-active="true"]')
  expect(activeLinks).toHaveLength(1)
  expect(activeLinks[0].getAttribute('href')).toBe(href)
  expect(panel.querySelector('output')?.textContent).toBe(kind)
}

describe('NavMenuCluster feature selection', () => {
  it('prefetches destinations only while their menu is open', () => {
    const overview = element('a[href="/platform"]')
    const customers = element('#nav-customers-menu a[href="/customers"]')
    expect(overview.dataset.prefetch).toBe('disabled')
    expect(customers.dataset.prefetch).toBe('disabled')

    hover(element('#nav-platform-menu-trigger'))
    expect(overview.dataset.prefetch).toBe('auto')
    expect(customers.dataset.prefetch).toBe('disabled')

    hover(element('#nav-customers-menu-trigger'))
    expect(overview.dataset.prefetch).toBe('disabled')
    expect(customers.dataset.prefetch).toBe('auto')

    act(() => {
      customers.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(customers.dataset.prefetch).toBe('disabled')
  })

  it('lets Tab enter Platform links, return to its trigger, and continue to Customers', () => {
    const platform = element('#nav-platform-menu-trigger')
    act(() => platform.focus())
    act(() => {
      platform.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    const overview = element('a[href="/platform"]')
    expect(document.activeElement).toBe(overview)
    expectSelected('/platform', 'overview')

    act(() => {
      overview.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
      )
    })
    expect(document.activeElement).toBe(platform)

    const logs = element('a[href="/logs"]')
    act(() => logs.focus())
    act(() => {
      logs.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(document.activeElement).toBe(element('#nav-customers-menu-trigger'))
    expect(element('#nav-customers-menu').getAttribute('aria-hidden')).toBe('false')
  })

  it('supports arrow entry and Escape returns focus without reopening the menu', () => {
    const platform = element('#nav-platform-menu-trigger')
    act(() => platform.focus())
    act(() => {
      platform.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    })
    expect(document.activeElement).toBe(element('a[href="/logs"]'))

    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      )
    })
    expect(document.activeElement).toBe(platform)
    expect(platform.getAttribute('aria-expanded')).toBe('false')

    act(() => platform.click())
    expect(document.activeElement).toBe(element('a[href="/platform"]'))
  })

  it('releases the desktop scroll lock when resized below the visible breakpoint', () => {
    hover(element('#nav-platform-menu-trigger'))
    setMenuOpen.mockClear()
    act(() => {
      desktopMedia.matches = false
      desktopMedia.dispatchEvent(new Event('change'))
    })
    expect(element('#nav-platform-menu-trigger').getAttribute('aria-expanded')).toBe('false')
    expect(setMenuOpen).toHaveBeenCalledExactlyOnceWith('desktop', false)
  })

  it('reports opening and pointer-exit closure during the event before effects flush', () => {
    const platform = element('#nav-platform-menu-trigger')

    act(() => {
      platform.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      expect(setMenuOpen).toHaveBeenCalledExactlyOnceWith('desktop', true)
    })

    setMenuOpen.mockClear()

    act(() => {
      platform.dispatchEvent(
        new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })
      )
      expect(setMenuOpen).toHaveBeenCalledExactlyOnceWith('desktop', false)
    })
  })

  it('stays open while the pointer crosses the header corridor into a menu link', () => {
    const platform = element('#nav-platform-menu-trigger')
    hover(platform)
    const bridge = element('[data-navigation-hover-bridge]')
    const overview = element('a[href="/platform"]')
    setMenuOpen.mockClear()

    act(() => {
      platform.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: bridge }))
      bridge.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: platform }))
      bridge.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: overview }))
      overview.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: bridge }))
    })

    expectSelected('/platform', 'overview')
    expect(setMenuOpen).not.toHaveBeenCalled()

    act(() => {
      overview.dispatchEvent(
        new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })
      )
    })

    expect(platform.getAttribute('aria-expanded')).toBe('false')
    expect(host.querySelector('[data-navigation-hover-bridge]')).toBeNull()
    expect(setMenuOpen).toHaveBeenCalledExactlyOnceWith('desktop', false)
  })

  it('only bridges the full header for an open surface menu', () => {
    expect(host.querySelector('[data-navigation-hover-bridge]')).toBeNull()

    hover(element('#nav-platform-menu-trigger'))
    expect(host.querySelector('[data-navigation-hover-bridge]')).not.toBeNull()

    hover(element('#nav-customers-menu-trigger'))
    expect(host.querySelector('[data-navigation-hover-bridge]')).toBeNull()
    expect(element('#nav-customers-menu').getAttribute('aria-hidden')).toBe('false')

    hover(element('#nav-resources-menu-trigger'))
    expect(host.querySelector('[data-navigation-hover-bridge]')).not.toBeNull()
  })

  it('opens on Overview and keeps the selected feature highlighted while viewing its preview', () => {
    hover(element('#nav-platform-menu-trigger'))
    expectSelected('/platform', 'overview')

    const workflows = element('a[href="/workflows"]')
    hover(workflows)
    expectSelected('/workflows', 'workflows')

    act(() => {
      workflows.dispatchEvent(
        new MouseEvent('mouseout', {
          bubbles: true,
          relatedTarget: element('output'),
        })
      )
    })
    expectSelected('/workflows', 'workflows')
  })

  it('returns to Overview when the pointer returns to the open Platform trigger', () => {
    const platform = element('#nav-platform-menu-trigger')
    hover(platform)
    hover(element('a[href="/tables"]'))
    expectSelected('/tables', 'tables')

    hover(platform)
    expect(platform.getAttribute('aria-expanded')).toBe('true')
    expectSelected('/platform', 'overview')
  })

  it('starts with Overview again after closing and reopening Platform', () => {
    const platform = element('#nav-platform-menu-trigger')
    hover(platform)
    const logs = element('a[href="/logs"]')
    hover(logs)
    expectSelected('/logs', 'logs')

    act(() => {
      logs.dispatchEvent(
        new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })
      )
    })
    expect(platform.getAttribute('aria-expanded')).toBe('false')
    expect(element('#primary-navigation-mega-menu').getAttribute('aria-hidden')).toBe('true')

    hover(platform)
    expectSelected('/platform', 'overview')
  })

  it('keeps keyboard selection and previews together when returning to a trigger or changing menus', () => {
    const platform = element('#nav-platform-menu-trigger')
    act(() => platform.focus())
    expectSelected('/platform', 'overview')

    act(() => element('a[href="/knowledge"]').focus())
    expectSelected('/knowledge', 'knowledge')

    act(() => platform.focus())
    expectSelected('/platform', 'overview')

    act(() => element('#nav-resources-menu-trigger').focus())
    expect(platform.getAttribute('aria-expanded')).toBe('false')
    expectSelected('https://docs.sim.ai', 'docs')

    act(() => platform.focus())
    expectSelected('/platform', 'overview')
  })
})
