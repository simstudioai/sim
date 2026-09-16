/**
 * @vitest-environment jsdom
 */
import { type AnchorHTMLAttributes, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileNav } from '@/app/(landing)/components/navbar/components/mobile-nav/mobile-nav'

const { frost, setMenuOpen } = vi.hoisted(() => {
  const setMenuOpen = vi.fn()
  return { frost: { setMenuOpen }, setMenuOpen }
})

vi.mock('@sim/emcn', () => ({
  cn: (...values: Array<string | false | undefined>) => values.filter(Boolean).join(' '),
}))
vi.mock('@sim/emcn/icons', () => ({ Menu: () => null, X: () => null }))
vi.mock('@/components/icons', () => ({ GithubOutlineIcon: () => null }))
vi.mock('next/link', () => ({
  default: ({
    prefetch,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean | null }) => (
    <a {...props} data-prefetch={prefetch === false ? 'disabled' : 'auto'} />
  ),
}))
vi.mock('@/app/(landing)/components/landing-cta-link', () => ({
  LandingCtaLink: ({ children, href, onClick }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
}))
vi.mock('@/app/(landing)/components/navbar/components/navbar-auth-pill', () => ({
  NavbarAuthPill: ({ onNavigate }: { onNavigate?: () => void }) => (
    <a href='/signup' onClick={onNavigate}>
      Start building
    </a>
  ),
}))
vi.mock('@/app/(landing)/components/navbar/components/nav-menu-chip', () => ({
  NAV_MENUS: [
    {
      label: 'Platform',
      sections: [{ label: 'Platform', items: [{ title: 'Workflows', href: '/workflows' }] }],
    },
  ],
}))
vi.mock('@/app/(landing)/components/navbar/components/navbar-shell', () => ({
  NAVBAR_GLASS_SURFACE: '',
  useNavbarFrost: () => frost,
}))

let host: HTMLDivElement
let root: Root
let desktopMedia: EventTarget & { matches: boolean }

beforeEach(() => {
  setMenuOpen.mockClear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  desktopMedia = Object.assign(new EventTarget(), { matches: false })
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => desktopMedia)
  )
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root.render(<MobileNav stars='29.5k' />))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

function trigger(): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>('button[aria-controls="mobile-nav-sheet"]')
  if (!button) throw new Error('Missing mobile navigation trigger')
  return button
}

describe('MobileNav dismissal', () => {
  it('stays open for internal focus and closes when focus moves into page content', () => {
    const link = host.querySelector<HTMLAnchorElement>('#mobile-nav-sheet a[href="/workflows"]')
    if (!link) throw new Error('Missing workflow link')
    const pageLink = document.createElement('a')
    pageLink.href = '#main-content'
    host.append(pageLink)

    act(() => {
      trigger().focus()
      trigger().click()
      link.focus()
    })
    expect(trigger().getAttribute('aria-expanded')).toBe('true')

    act(() => pageLink.focus())
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(setMenuOpen).toHaveBeenLastCalledWith('mobile', false)
    expect(document.activeElement).toBe(pageLink)
  })

  it('enables prefetch only while the sheet is open and closes on navigation', () => {
    const link = host.querySelector<HTMLAnchorElement>('#mobile-nav-sheet a[href="/workflows"]')
    if (!link) throw new Error('Missing workflow link')
    expect(link.dataset.prefetch).toBe('disabled')

    act(() => trigger().click())
    expect(link.dataset.prefetch).toBe('auto')
    link.addEventListener('click', (event) => event.preventDefault(), { once: true })
    act(() => link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(link.dataset.prefetch).toBe('disabled')
    expect(setMenuOpen).toHaveBeenLastCalledWith('mobile', false)
  })

  it('releases its scroll lock when resizing to desktop and stays closed when returning', () => {
    act(() => trigger().click())
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    setMenuOpen.mockClear()
    act(() => {
      desktopMedia.matches = true
      desktopMedia.dispatchEvent(new Event('change'))
    })
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(setMenuOpen).toHaveBeenCalledExactlyOnceWith('mobile', false)
    act(() => {
      desktopMedia.matches = false
      desktopMedia.dispatchEvent(new Event('change'))
    })
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
  })

  it('returns focus to the trigger when Escape dismisses the sheet', () => {
    act(() => trigger().click())
    const link = host.querySelector<HTMLAnchorElement>('#mobile-nav-sheet a[href="/workflows"]')
    if (!link) throw new Error('Missing workflow link')
    act(() => link.focus())
    act(() => link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger())
    expect(setMenuOpen).toHaveBeenLastCalledWith('mobile', false)
  })
})
