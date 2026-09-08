/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUsePathname } = vi.hoisted(() => ({ mockUsePathname: vi.fn() }))

vi.mock('next/navigation', () => ({ usePathname: mockUsePathname }))

import { ThemeProvider } from '@/app/_shell/providers/theme-provider'

let root: Root
let host: HTMLDivElement

/** A dark OS, so `system` resolves to dark wherever it applies. */
function stubDarkOs() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('dark'),
      media: query,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  )
}

function render(pathname: string) {
  mockUsePathname.mockReturnValue(pathname)
  act(() => root.render(<ThemeProvider>child</ThemeProvider>))
  return document.documentElement.classList
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubDarkOs()
  localStorage.clear()
  document.documentElement.className = ''
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('ThemeProvider theme stores', () => {
  it('renders the landing light for a signed-in user whose app theme is system', () => {
    localStorage.setItem('sim-theme', 'system')
    expect(render('/')).toContain('light')
  })

  it('honours a theme chosen from the landing footer', () => {
    localStorage.setItem('sim-theme', 'system')
    localStorage.setItem('sim-landing-theme', 'dark')
    expect(render('/workflows')).toContain('dark')
  })

  it('keeps the workspace on the account-synced store', () => {
    localStorage.setItem('sim-landing-theme', 'light')
    localStorage.setItem('sim-theme', 'system')
    expect(render('/workspace/ws-1/home')).toContain('dark')
  })

  it('still forces light on the auth shell regardless of either store', () => {
    localStorage.setItem('sim-theme', 'dark')
    localStorage.setItem('sim-landing-theme', 'dark')
    expect(render('/login')).toContain('light')
  })
})
