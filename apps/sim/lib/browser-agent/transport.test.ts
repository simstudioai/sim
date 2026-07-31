import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  activateScope,
  discardScope,
  disposeScope,
  markScopeSuspended,
  migrateStoreScope,
  nativeMigrateScope,
  onPageState,
  onSessionStatus,
  onTabsState,
  onCloseFind,
  onFindResult,
  onFocusOmnibox,
  onOpenFind,
  onPanelSnapshot,
  onScopeSuspended,
  reorderTab,
  restoreScope,
  nativeSuspendScope,
  setPageState,
  setPanelBounds,
  setPanelFocused,
  setPanelOccluded,
  setPanelSnapshot,
  setSessionAlive,
  setTabPinned,
  setTheme,
  setTabsState,
  setTabsSupported,
} = vi.hoisted(() => ({
  activateScope: vi.fn(),
  discardScope: vi.fn(),
  disposeScope: vi.fn(async () => true),
  markScopeSuspended: vi.fn(),
  migrateStoreScope: vi.fn(),
  nativeMigrateScope: vi.fn(),
  onPageState: vi.fn(),
  onSessionStatus: vi.fn(),
  onTabsState: vi.fn(),
  onCloseFind: vi.fn(),
  onFindResult: vi.fn(),
  onFocusOmnibox: vi.fn(),
  onOpenFind: vi.fn(),
  onPanelSnapshot: vi.fn(),
  onScopeSuspended: vi.fn(),
  reorderTab: vi.fn(),
  restoreScope: vi.fn(),
  nativeSuspendScope: vi.fn(async () => true),
  setPageState: vi.fn(),
  setPanelBounds: vi.fn(),
  setPanelFocused: vi.fn(),
  setPanelOccluded: vi.fn(),
  setPanelSnapshot: vi.fn(),
  setSessionAlive: vi.fn(),
  setTabPinned: vi.fn(),
  setTheme: vi.fn(),
  setTabsState: vi.fn(),
  setTabsSupported: vi.fn(),
}))

vi.mock('@/lib/desktop', () => ({
  getDesktopBridge: () => ({
    browserAgent: {
      executeTool: vi.fn(),
      disposeScope,
      getTabsState: vi.fn(async () => ({ tabs: [], activeTabId: null })),
      migrateScope: nativeMigrateScope,
      onCloseFind,
      onFindResult,
      onFocusOmnibox,
      onOpenFind,
      onPageState,
      onPanelSnapshot,
      onScopeSuspended,
      onSessionStatus,
      onTabsState,
      panelAction: vi.fn(),
      reorderTab,
      restoreScope,
      suspendScope: nativeSuspendScope,
      setPanelBounds,
      setPanelFocused,
      setPanelOccluded,
      setTabPinned,
      setTheme,
    },
  }),
}))

vi.mock('@/stores/browser-session/store', () => ({
  LEGACY_BROWSER_SCOPE: 'legacy',
  useBrowserSessionStore: {
    getState: () => ({
      activeScopeId: 'legacy',
      activateScope,
      discardScope,
      migrateScope: migrateStoreScope,
      suspendScope: markScopeSuspended,
      setPageState,
      setPanelSnapshot,
      setSessionAlive,
      setTabsState,
      setTabsSupported,
    }),
  },
}))

import {
  discardBrowserScope,
  initBrowserAgentTransport,
  isBrowserTabPinningAvailable,
  isBrowserTabReorderingAvailable,
  migrateBrowserScope,
  onBrowserFindClose,
  onBrowserFindOpen,
  onBrowserFindResult,
  onBrowserOmniboxFocus,
  reorderBrowserTab,
  reportBrowserPanelBounds,
  reportBrowserPanelFocused,
  reportBrowserPanelOcclusion,
  reportBrowserTheme,
  resetBrowserPanelOcclusion,
  restoreBrowserScope,
  setBrowserTabPinned,
  suspendBrowserScope,
} from '@/lib/browser-agent/transport'

describe('browser panel transport', () => {
  beforeEach(() => {
    resetBrowserPanelOcclusion()
    setPanelBounds.mockClear()
    setPanelFocused.mockClear()
    setPanelOccluded.mockClear()
    setPageState.mockClear()
    setPanelSnapshot.mockClear()
    setSessionAlive.mockClear()
    setTabsState.mockClear()
    setTabsSupported.mockClear()
    reorderTab.mockClear()
    restoreScope.mockReset()
    nativeSuspendScope.mockReset()
    nativeSuspendScope.mockResolvedValue(true)
    markScopeSuspended.mockClear()
    migrateStoreScope.mockClear()
    nativeMigrateScope.mockReset()
    setTabPinned.mockClear()
    setTheme.mockClear()
    discardScope.mockClear()
    disposeScope.mockClear()
  })

  it('forwards panel bounds independently from native-view occlusion', () => {
    const initialBounds = { x: 10, y: 20, width: 300, height: 200 }
    const updatedBounds = { x: 20, y: 30, width: 320, height: 220 }

    reportBrowserPanelBounds(initialBounds)
    reportBrowserPanelOcclusion(true)
    reportBrowserPanelBounds(updatedBounds)
    reportBrowserPanelOcclusion(false)

    // A caller with no anchor to declare keeps whatever was last retained —
    // here there was never one, so the shell is told null both times.
    expect(setPanelBounds.mock.calls).toEqual([
      [initialBounds, null, 'legacy'],
      [updatedBounds, null, 'legacy'],
    ])
    expect(setPanelOccluded.mock.calls).toEqual([
      [true, 'legacy'],
      [false, 'legacy'],
    ])
  })

  it('forwards renderer-owned browser chrome focus', () => {
    reportBrowserPanelFocused(true)
    reportBrowserPanelFocused(false)

    expect(setPanelFocused.mock.calls).toEqual([
      [true, 'legacy'],
      [false, 'legacy'],
    ])
  })

  it('forwards tab pinning only through shells that advertise support', () => {
    expect(isBrowserTabPinningAvailable()).toBe(true)

    setBrowserTabPinned('tab-2', true)
    setBrowserTabPinned('tab-2', false)

    expect(setTabPinned.mock.calls).toEqual([
      ['tab-2', true, 'legacy'],
      ['tab-2', false, 'legacy'],
    ])
  })

  it('forwards tab reordering only through shells that advertise support', () => {
    expect(isBrowserTabReorderingAvailable()).toBe(true)

    reorderBrowserTab('tab-3', 1)

    expect(reorderTab).toHaveBeenCalledWith('tab-3', 1, 'legacy')
  })

  it('forgets an abandoned provisional browser scope on both sides', async () => {
    await discardBrowserScope('pending:new')

    expect(discardScope).toHaveBeenCalledWith('pending:new')
    expect(disposeScope).toHaveBeenCalledWith('pending:new')
  })

  it('moves renderer state only after native scope migration succeeds', async () => {
    nativeMigrateScope.mockResolvedValue({
      scopeId: 'chat-real',
      tabs: [],
      activeTabId: null,
    })

    await migrateBrowserScope('pending:new', 'chat-real')

    expect(nativeMigrateScope).toHaveBeenCalledWith('pending:new', 'chat-real')
    expect(migrateStoreScope).toHaveBeenCalledWith('pending:new', 'chat-real')
    expect(disposeScope).not.toHaveBeenCalled()
  })

  it('discards a provisional browser scope when the durable destination wins', async () => {
    nativeMigrateScope.mockResolvedValue({ tabs: [], activeTabId: null })

    await migrateBrowserScope('pending:new', 'chat-existing')

    expect(migrateStoreScope).not.toHaveBeenCalled()
    expect(discardScope).toHaveBeenCalledWith('pending:new')
    expect(disposeScope).toHaveBeenCalledWith('pending:new')
  })

  it('drops stale renderer tabs only after a durable browser scope is suspended', async () => {
    await expect(suspendBrowserScope('chat-deleted')).resolves.toBe(true)

    expect(nativeSuspendScope).toHaveBeenCalledWith('chat-deleted')
    expect(markScopeSuspended).toHaveBeenCalledWith('chat-deleted')
    await expect(suspendBrowserScope('pending:new')).resolves.toBe(false)
  })

  it('retains renderer tabs when native browser suspension fails', async () => {
    nativeSuspendScope.mockResolvedValue(false)

    await expect(suspendBrowserScope('chat-deleted')).resolves.toBe(false)

    expect(markScopeSuspended).not.toHaveBeenCalled()
  })

  it('restores a lazy scoped session into the matching renderer bucket', async () => {
    const tabsState = {
      scopeId: 'chat-restored',
      tabs: [
        {
          tabId: '1',
          url: 'https://restored.example/',
          title: 'Restored',
          loading: false,
          active: true,
          pinned: false,
        },
      ],
      activeTabId: '1',
    }
    restoreScope.mockResolvedValue(tabsState)

    await expect(restoreBrowserScope('chat-restored')).resolves.toBe(true)

    expect(restoreScope).toHaveBeenCalledWith('chat-restored')
    expect(setTabsSupported).toHaveBeenCalledWith(true, 'chat-restored')
    expect(setTabsState).toHaveBeenCalledWith(tabsState, 'chat-restored')
  })

  it('wires captured browser frames into the browser-session store', () => {
    initBrowserAgentTransport()
    const listener = onPanelSnapshot.mock.calls[0][0] as (snapshot: {
      dataUrl: string
      tabId: string
    }) => void
    const snapshot = { dataUrl: 'data:image/png;base64,c2lt', tabId: 'tab-1' }

    listener(snapshot)

    expect(setPanelSnapshot).toHaveBeenCalledWith(snapshot, 'legacy')
  })

  it('routes late browser events to the scope carried by the event', () => {
    initBrowserAgentTransport()
    const pageListener = onPageState.mock.calls[0][0] as (state: {
      tabId: string
      scopeId: string
      url: string
      title: string
      loading: boolean
      canGoBack: boolean
      canGoForward: boolean
    }) => void
    const tabsListener = onTabsState.mock.calls[0][0] as (state: {
      scopeId: string
      tabs: []
      activeTabId: null
    }) => void
    const statusListener = onSessionStatus.mock.calls[0][0] as (
      alive: boolean,
      scopeId?: string
    ) => void
    const pageState = {
      tabId: 'same-id',
      scopeId: 'chat-a',
      url: 'https://a.example',
      title: 'A',
      loading: false,
      canGoBack: false,
      canGoForward: false,
    }
    const tabsState = { scopeId: 'chat-b', tabs: [] as [], activeTabId: null }

    pageListener(pageState)
    tabsListener(tabsState)
    statusListener(false, 'chat-c')

    expect(setPageState).toHaveBeenCalledWith(pageState, 'chat-a')
    expect(setTabsSupported).toHaveBeenCalledWith(true, 'chat-b')
    expect(setTabsState).toHaveBeenCalledWith(tabsState, 'chat-b')
    expect(setSessionAlive).toHaveBeenCalledWith(false, 'chat-c')
  })

  it('applies native suspension pushes to the matching renderer scope', () => {
    initBrowserAgentTransport()
    const listener = onScopeSuspended.mock.calls[0][0] as (scopeId: string) => void

    listener('chat-background')

    expect(markScopeSuspended).toHaveBeenCalledWith('chat-background')
  })

  it('keeps geometry and occlusion independent for two chat scopes', () => {
    const a = { x: 1, y: 2, width: 300, height: 200 }
    const b = { x: 10, y: 20, width: 400, height: 250 }

    reportBrowserPanelBounds(a, null, 'chat-a')
    reportBrowserPanelOcclusion(true, 'chat-a')
    reportBrowserPanelBounds(b, null, 'chat-b')
    reportBrowserPanelOcclusion(true, 'chat-b')
    reportBrowserPanelOcclusion(false, 'chat-a')

    expect(setPanelBounds.mock.calls).toEqual([
      [a, null, 'chat-a'],
      [b, null, 'chat-b'],
    ])
    expect(setPanelOccluded.mock.calls).toEqual([
      [true, 'chat-a'],
      [true, 'chat-b'],
      [false, 'chat-a'],
    ])
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

    expect(onBrowserOmniboxFocus(callback, 'chat-a')).toBe(unsubscribe)
    const listener = onFocusOmnibox.mock.calls[0][0] as (
      mode: 'clear' | 'select',
      scopeId?: string
    ) => void
    listener('clear', 'chat-b')
    listener('select', 'chat-a')

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith('select')
  })

  it('filters asynchronous find events to the subscribing chat', () => {
    const open = vi.fn()
    const close = vi.fn()
    const result = vi.fn()
    onBrowserFindOpen(open, 'chat-a')
    onBrowserFindClose(close, 'chat-a')
    onBrowserFindResult(result, 'chat-a')
    const openListener = onOpenFind.mock.calls[0][0] as (scopeId?: string) => void
    const closeListener = onCloseFind.mock.calls[0][0] as (scopeId?: string) => void
    const resultListener = onFindResult.mock.calls[0][0] as (
      value: { activeMatchOrdinal: number; matches: number; final: boolean },
      scopeId?: string
    ) => void
    const value = { activeMatchOrdinal: 1, matches: 2, final: true }

    openListener('chat-b')
    closeListener('chat-b')
    resultListener(value, 'chat-b')
    expect(open).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    expect(result).not.toHaveBeenCalled()

    openListener('chat-a')
    closeListener('chat-a')
    resultListener(value, 'chat-a')
    expect(open).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(result).toHaveBeenCalledWith(value)
  })
})
