/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetDesktopBridge } = vi.hoisted(() => ({ mockGetDesktopBridge: vi.fn() }))

vi.mock('@/lib/desktop', () => ({ getDesktopBridge: mockGetDesktopBridge }))

import {
  DESKTOP_TITLE_BAR_ATTRIBUTE,
  DesktopTitleBarController,
} from '@/app/_shell/desktop-title-bar'

let container: HTMLDivElement
let root: Root

/**
 * A bridge whose `getState` never settles, which is the window this guards: the gap
 * between mount and the async state arriving is exactly when the old code clobbered
 * whatever mode another owner had already established.
 */
function pendingBridge() {
  return {
    windowState: {
      onStateChange: vi.fn(() => vi.fn()),
      getState: vi.fn(() => new Promise<never>(() => {})),
    },
  }
}

function mount() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<DesktopTitleBarController />))
}

beforeEach(() => {
  vi.clearAllMocks()
  document.documentElement.removeAttribute(DESKTOP_TITLE_BAR_ATTRIBUTE)
  Object.defineProperty(navigator, 'userAgent', {
    value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    configurable: true,
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.documentElement.removeAttribute(DESKTOP_TITLE_BAR_ATTRIBUTE)
})

describe('DesktopTitleBarController', () => {
  it('leaves an established mode alone while its own state is still pending', () => {
    mockGetDesktopBridge.mockReturnValue(pendingBridge())
    // Native fullscreen, set by WorkspaceChrome. A lane-aware overlay mounting here used
    // to seed `inset` first, snapping the traffic-light lane back on and jumping the
    // content until the async state corrected it — or permanently, if `getState` rejected.
    document.documentElement.setAttribute(DESKTOP_TITLE_BAR_ATTRIBUTE, 'fullscreen')

    mount()

    expect(document.documentElement.getAttribute(DESKTOP_TITLE_BAR_ATTRIBUTE)).toBe('fullscreen')
  })

  it('seeds inset when no owner has set a mode yet', () => {
    mockGetDesktopBridge.mockReturnValue(pendingBridge())

    mount()

    expect(document.documentElement.getAttribute(DESKTOP_TITLE_BAR_ATTRIBUTE)).toBe('inset')
  })

  it('clears the marker off the desktop shell', () => {
    mockGetDesktopBridge.mockReturnValue(null)
    document.documentElement.setAttribute(DESKTOP_TITLE_BAR_ATTRIBUTE, 'inset')

    mount()

    expect(document.documentElement.hasAttribute(DESKTOP_TITLE_BAR_ATTRIBUTE)).toBe(false)
  })
})
