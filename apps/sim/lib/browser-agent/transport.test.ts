import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  onFocusOmnibox,
  onPanelSnapshot,
  setPageState,
  setPanelBounds,
  setPanelFocused,
  setPanelOccluded,
  setPanelSnapshot,
  setSessionAlive,
  setTheme,
  setTabsState,
  setTabsSupported,
} = vi.hoisted(() => ({
  onFocusOmnibox: vi.fn(),
  onPanelSnapshot: vi.fn(),
  setPageState: vi.fn(),
  setPanelBounds: vi.fn(),
  setPanelFocused: vi.fn(),
  setPanelOccluded: vi.fn(),
  setPanelSnapshot: vi.fn(),
  setSessionAlive: vi.fn(),
  setTheme: vi.fn(),
  setTabsState: vi.fn(),
  setTabsSupported: vi.fn(),
}))

vi.mock('@/lib/desktop', () => ({
  getDesktopBridge: () => ({
    browserAgent: {
      executeTool: vi.fn(),
      getTabsState: vi.fn(async () => ({ tabs: [], activeTabId: null })),
      onFocusOmnibox,
      onPageState: vi.fn(),
      onPanelSnapshot,
      onSessionStatus: vi.fn(),
      onTabsState: vi.fn(),
      panelAction: vi.fn(),
      setPanelBounds,
      setPanelFocused,
      setPanelOccluded,
      setTheme,
    },
  }),
}))

vi.mock('@/stores/browser-session/store', () => ({
  useBrowserSessionStore: {
    getState: () => ({
      setPageState,
      setPanelSnapshot,
      setSessionAlive,
      setTabsState,
      setTabsSupported,
    }),
  },
}))

import {
  initBrowserAgentTransport,
  onBrowserOmniboxFocus,
  reportBrowserPanelBounds,
  reportBrowserPanelFocused,
  reportBrowserPanelOcclusion,
  reportBrowserTheme,
  resetBrowserPanelOcclusion,
} from '@/lib/browser-agent/transport'

describe('browser panel transport', () => {
  beforeEach(() => {
    resetBrowserPanelOcclusion()
    setPanelBounds.mockClear()
    setPanelFocused.mockClear()
    setPanelOccluded.mockClear()
    setTheme.mockClear()
  })

  it('forwards panel bounds independently from native-view occlusion', () => {
    const initialBounds = { x: 10, y: 20, width: 300, height: 200 }
    const updatedBounds = { x: 20, y: 30, width: 320, height: 220 }

    reportBrowserPanelBounds(initialBounds)
    reportBrowserPanelOcclusion(true)
    reportBrowserPanelBounds(updatedBounds)
    reportBrowserPanelOcclusion(false)

    expect(setPanelBounds.mock.calls).toEqual([[initialBounds], [updatedBounds]])
    expect(setPanelOccluded.mock.calls).toEqual([[true], [false]])
  })

  it('forwards renderer-owned browser chrome focus', () => {
    reportBrowserPanelFocused(true)
    reportBrowserPanelFocused(false)

    expect(setPanelFocused.mock.calls).toEqual([[true], [false]])
  })

  it('wires captured browser frames into the browser-session store', () => {
    initBrowserAgentTransport()
    const listener = onPanelSnapshot.mock.calls[0][0] as (snapshot: {
      dataUrl: string
      tabId: string
    }) => void
    const snapshot = { dataUrl: 'data:image/png;base64,c2lt', tabId: 'tab-1' }

    listener(snapshot)

    expect(setPanelSnapshot).toHaveBeenCalledWith(snapshot)
  })

  it('forwards Sim theme preferences to the desktop browser', () => {
    reportBrowserTheme('dark')
    reportBrowserTheme('light')
    reportBrowserTheme('system')

    expect(setTheme.mock.calls).toEqual([['dark'], ['light'], ['system']])
  })

  it('subscribes to native omnibox focus requests', () => {
    const unsubscribe = vi.fn()
    const callback = vi.fn()
    onFocusOmnibox.mockReturnValue(unsubscribe)

    expect(onBrowserOmniboxFocus(callback)).toBe(unsubscribe)
    expect(onFocusOmnibox).toHaveBeenCalledWith(callback)
  })
})
