/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import type { BrowserPageState } from '@sim/browser-protocol'
import type { BrowserToolbarCommand } from '@sim/desktop-bridge'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { desktop, navigateToSettings, removeResource } = vi.hoisted(() => ({
  navigateToSettings: vi.fn(),
  removeResource: vi.fn(),
  desktop: {
    settings: { getPreferences: vi.fn(async () => ({ browserTheme: 'app' })) },
    browserCredentials: { list: vi.fn(async () => []), onFillAvailability: vi.fn(() => () => {}) },
    browserImport: {
      listChromeProfiles: vi.fn(async () => []),
      listSites: vi.fn(async () => []),
      importFromChrome: vi.fn(),
    },
    browserAgent: {
      supportsAtomicPanelOcclusion: true,
      setTheme: vi.fn(),
      setPanelBounds: vi.fn(),
      setPanelFocused: vi.fn(),
      setPanelOccluded: vi.fn(async () => true),
      capturePanelSnapshot: vi.fn(async () => null),
      getKnownSessions: vi.fn(async () => ({ sessions: [] })),
      getDownloadsState: vi.fn(async () => ({ downloads: [] })),
      onAppearanceThemeChanged: vi.fn(() => () => {}),
      onToolbarCommand: vi.fn(
        (_callback: (command: BrowserToolbarCommand, scopeId: string) => void) => () => {}
      ),
      onAddToChat: vi.fn(() => () => {}),
      onFocusOmnibox: vi.fn(() => () => {}),
      onOpenFind: vi.fn(() => () => {}),
      onCloseFind: vi.fn(() => () => {}),
      onDownloadsState: vi.fn(() => () => {}),
    },
  },
}))

vi.mock('@/lib/desktop', () => ({ getDesktopBridge: () => desktop }))
vi.mock('@/hooks/use-settings-navigation', () => ({
  useSettingsNavigation: () => ({ navigateToSettings }),
}))
vi.mock('@/app/workspace/[workspaceId]/home/components/mothership-resources-context', () => ({
  useMothershipResources: () => ({ removeResource }),
}))

import { BrowserSession } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-session'
import { useBrowserSessionStore } from '@/stores/browser-session/store'

const PAGE: BrowserPageState = {
  scopeId: 'browser-ui-test',
  tabId: 'tab-1',
  url: 'about:blank',
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
}
let container: HTMLDivElement
let root: Root

async function render(page: BrowserPageState = PAGE, visible = true) {
  await act(async () => {
    useBrowserSessionStore.getState().setPageState(page)
    root.render(<BrowserSession visible={visible} scopeId={PAGE.scopeId} />)
  })
  await act(async () => vi.advanceTimersByTime(20))
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  )
  vi.clearAllMocks()
  useBrowserSessionStore.setState({ sessions: {} })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    width: 700,
    height: 600,
    top: 0,
    bottom: 600,
    left: 0,
    right: 700,
    toJSON: () => ({}),
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('browser empty state and in-place import', () => {
  it('replaces the native blank page with shared guidance and no extra actions', async () => {
    await render()
    const emptyState = container.querySelector('section[aria-label="New tab"]')
    expect(emptyState?.textContent).toContain('Browse the web')
    expect(emptyState?.textContent).toContain('Search or enter a URL above.')
    expect(emptyState?.querySelector('button')).toBeNull()
    expect(desktop.browserAgent.setPanelBounds).toHaveBeenLastCalledWith(null, null, PAGE.scopeId)
    expect(container.querySelector('input')).not.toBeNull()
  })

  it('hands the surface back to the native page for navigation and restores it on a blank tab', async () => {
    await render()
    await render({ ...PAGE, loading: true })
    expect(container.querySelector('section[aria-label="New tab"]')).toBeNull()
    expect(desktop.browserAgent.setPanelBounds.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ width: 700, height: 600 })
    )
    await render({ ...PAGE, url: 'https://example.com' })
    expect(container.querySelector('section[aria-label="New tab"]')).toBeNull()
    await render()
    expect(container.querySelector('section[aria-label="New tab"]')).not.toBeNull()
    expect(desktop.browserAgent.setPanelBounds).toHaveBeenLastCalledWith(null, null, PAGE.scopeId)
  })

  it('does not replace load errors with the new-tab state', async () => {
    await render({
      ...PAGE,
      issue: {
        kind: 'load-error',
        url: 'https://missing.example',
        code: -105,
        description: 'ERR_NAME_NOT_RESOLVED',
      },
    })
    expect(container.textContent).toContain("This site can't be reached")
    expect(container.querySelector('section[aria-label="New tab"]')).toBeNull()
  })

  it('opens import in place from the native toolbar command', async () => {
    await render()
    const callback = desktop.browserAgent.onToolbarCommand.mock.calls[0][0]
    await act(async () => callback('import', PAGE.scopeId))
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Import from your browser'
    )
    expect(navigateToSettings).not.toHaveBeenCalled()
    expect(desktop.browserImport.listChromeProfiles).toHaveBeenCalledOnce()
    expect(document.querySelector<HTMLElement>('[role="dialog"]')?.style.visibility).not.toBe(
      'hidden'
    )
    expect(desktop.browserAgent.setPanelOccluded).toHaveBeenCalledWith(true, PAGE.scopeId, true)
  })
})
