import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  activateScope,
  capturePanelSnapshot,
  discardScope,
  disposeScope,
  fillCredential,
  listFillOptions,
  markScopeSuspended,
  migrateStoreScope,
  nativeMigrateScope,
  onPageState,
  onSessionStatus,
  onTabsState,
  onCloseFind,
  onAddToChat,
  onFindResult,
  onFillAvailability,
  onFocusOmnibox,
  onOpenFind,
  onScopeSuspended,
  onToolbarCommand,
  reorderTab,
  restoreScope,
  nativeSuspendScope,
  setPageState,
  setPanelBounds,
  setPanelFocused,
  setPanelOccluded,
  setSessionAlive,
  setTabPinned,
  showCredentialChooser,
  showTabContextMenu,
  showToolbarMenu,
  setTheme,
  setTabsState,
  setTabsSupported,
} = vi.hoisted(() => ({
  activateScope: vi.fn(),
  capturePanelSnapshot: vi.fn(),
  discardScope: vi.fn(),
  disposeScope: vi.fn(async () => true),
  fillCredential: vi.fn(async () => true),
  listFillOptions: vi.fn(async () => []),
  markScopeSuspended: vi.fn(),
  migrateStoreScope: vi.fn(),
  nativeMigrateScope: vi.fn(),
  onPageState: vi.fn(),
  onSessionStatus: vi.fn(),
  onTabsState: vi.fn(),
  onCloseFind: vi.fn(),
  onAddToChat: vi.fn(),
  onFindResult: vi.fn(),
  onFillAvailability: vi.fn(),
  onFocusOmnibox: vi.fn(),
  onOpenFind: vi.fn(),
  onScopeSuspended: vi.fn(),
  onToolbarCommand: vi.fn(),
  reorderTab: vi.fn(),
  restoreScope: vi.fn(),
  nativeSuspendScope: vi.fn(async () => true),
  setPageState: vi.fn(),
  setPanelBounds: vi.fn(),
  setPanelFocused: vi.fn(),
  setPanelOccluded: vi.fn(),
  setSessionAlive: vi.fn(),
  setTabPinned: vi.fn(),
  showCredentialChooser: vi.fn(async () => true),
  showTabContextMenu: vi.fn(),
  showToolbarMenu: vi.fn(),
  setTheme: vi.fn(),
  setTabsState: vi.fn(),
  setTabsSupported: vi.fn(),
}))

vi.mock('@/lib/desktop', () => ({
  getDesktopBridge: () => ({
    browserAgent: {
      executeTool: vi.fn(),
      capturePanelSnapshot,
      disposeScope,
      getTabsState: vi.fn(async () => ({ tabs: [], activeTabId: null })),
      migrateScope: nativeMigrateScope,
      onCloseFind,
      onAddToChat,
      onFindResult,
      onFocusOmnibox,
      onOpenFind,
      onPageState,
      onScopeSuspended,
      onToolbarCommand,
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
      showTabContextMenu,
      showToolbarMenu,
      setTheme,
    },
    browserCredentials: {
      fill: fillCredential,
      listFillOptions,
      onFillAvailability,
      showChooser: showCredentialChooser,
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
      setSessionAlive,
      setTabsState,
      setTabsSupported,
    }),
  },
}))

import {
  captureBrowserPanelSnapshot,
  discardBrowserScope,
  fillBrowserCredential,
  initBrowserAgentTransport,
  isBrowserPanelOcclusionAvailable,
  isBrowserTabPinningAvailable,
  isBrowserTabReorderingAvailable,
  loadBrowserFillOptions,
  migrateBrowserScope,
  onBrowserAddToChat,
  onBrowserFillAvailability,
  onBrowserFindClose,
  onBrowserFindOpen,
  onBrowserFindResult,
  onBrowserOmniboxFocus,
  onBrowserToolbarCommand,
  reorderBrowserTab,
  reportBrowserPanelBounds,
  reportBrowserPanelFocused,
  reportBrowserTheme,
  restoreBrowserScope,
  setBrowserPanelOccluded,
  setBrowserTabPinned,
  showBrowserCredentialChooser,
  showBrowserTabContextMenu,
  showBrowserToolbarMenu,
  suspendBrowserScope,
} from '@/lib/browser-agent/transport'

describe('browser panel transport', () => {
  beforeEach(() => {
    setPanelBounds.mockClear()
    setPanelFocused.mockClear()
    capturePanelSnapshot.mockReset()
    setPanelOccluded.mockReset()
    setPageState.mockClear()
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
    showTabContextMenu.mockClear()
    showToolbarMenu.mockClear()
    onToolbarCommand.mockClear()
    onAddToChat.mockClear()
    onFillAvailability.mockClear()
    setTheme.mockClear()
    discardScope.mockClear()
    disposeScope.mockClear()
  })

  it('forwards panel bounds directly to the native view', () => {
    const initialBounds = { x: 10, y: 20, width: 300, height: 200 }
    const updatedBounds = { x: 20, y: 30, width: 320, height: 220 }

    reportBrowserPanelBounds(initialBounds)
    reportBrowserPanelBounds(updatedBounds)

    // A caller with no anchor to declare keeps whatever was last retained —
    // here there was never one, so the shell is told null both times.
    expect(setPanelBounds.mock.calls).toEqual([
      [initialBounds, null, 'legacy'],
      [updatedBounds, null, 'legacy'],
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

  it('captures and swaps the native panel within the requested chat scope', async () => {
    const snapshot = {
      dataUrl: 'data:image/png;base64,c2lt',
      tabId: 'tab-1',
      zoomPercent: 100,
      scopeId: 'chat-a',
    }
    capturePanelSnapshot.mockResolvedValue(snapshot)
    setPanelOccluded.mockResolvedValue(true)

    expect(isBrowserPanelOcclusionAvailable()).toBe(true)
    await expect(captureBrowserPanelSnapshot('chat-a')).resolves.toEqual(snapshot)
    await expect(setBrowserPanelOccluded(true, 'chat-a')).resolves.toBe(true)
    await expect(setBrowserPanelOccluded(false, 'chat-a')).resolves.toBe(true)

    expect(capturePanelSnapshot).toHaveBeenCalledWith('chat-a')
    expect(setPanelOccluded.mock.calls).toEqual([
      [true, 'chat-a'],
      [false, 'chat-a'],
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

  it('opens the native tab menu in the matching browser scope', () => {
    showBrowserTabContextMenu('tab-2', 'chat-a')

    expect(showTabContextMenu).toHaveBeenCalledWith('tab-2', 'chat-a')
  })

  it('opens and scopes the native browser toolbar menu', () => {
    showBrowserToolbarMenu({ x: 10, y: 20 }, 'chat-a')
    expect(showToolbarMenu).toHaveBeenCalledWith({ x: 10, y: 20 }, 'chat-a')

    const callback = vi.fn()
    onBrowserToolbarCommand(callback, 'chat-a')
    const listener = onToolbarCommand.mock.calls[0][0] as (
      command: 'browser-settings',
      scopeId?: string
    ) => void
    listener('browser-settings', 'chat-b')
    listener('browser-settings', 'chat-a')
    expect(callback).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledWith('browser-settings')
  })

  it('routes Add to chat payloads only to their owning browser scope', () => {
    const callback = vi.fn()
    onBrowserAddToChat(callback, 'chat-a')
    const listener = onAddToChat.mock.calls[0][0] as (payload: {
      text: string
      tabId: string
      scopeId: string
    }) => void
    listener({ text: 'wrong chat', tabId: '1', scopeId: 'chat-b' })
    listener({ text: 'selected text', tabId: '2', scopeId: 'chat-a' })

    expect(callback).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledWith({
      text: 'selected text',
      tabId: '2',
      scopeId: 'chat-a',
    })
  })

  it('subscribes to and filters fill availability for one browser scope', () => {
    const callback = vi.fn()
    onBrowserFillAvailability(callback, 'chat-a')
    const listener = onFillAvailability.mock.calls[0][0] as (state: {
      available: boolean
      scopeId?: string
    }) => void

    listener({ available: true, scopeId: 'chat-b' })
    listener({ available: true, scopeId: 'chat-a' })

    expect(onFillAvailability).toHaveBeenCalledWith(expect.any(Function), 'chat-a')
    expect(callback).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledWith(true)
  })

  it('loads and fills scoped credential choices through the desktop shell', async () => {
    const options = [
      {
        id: 'credential-1',
        origin: 'https://example.com',
        username: 'ada@example.com',
        createdAt: '',
        updatedAt: '',
        source: 'chrome' as const,
      },
    ]
    listFillOptions.mockResolvedValue(options)

    await expect(loadBrowserFillOptions('chat-a')).resolves.toEqual(options)
    await expect(fillBrowserCredential('credential-1', 'chat-a')).resolves.toBe(true)

    expect(listFillOptions).toHaveBeenCalledWith('chat-a')
    expect(fillCredential).toHaveBeenCalledWith('credential-1', 'chat-a')
  })

  it('keeps the native credential fallback in the owning browser scope', () => {
    showBrowserCredentialChooser({ x: 10, y: 20 }, 'chat-a')

    expect(showCredentialChooser).toHaveBeenCalledWith({ x: 10, y: 20 }, 'chat-a')
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

  it('keeps geometry independent for two chat scopes', () => {
    const a = { x: 1, y: 2, width: 300, height: 200 }
    const b = { x: 10, y: 20, width: 400, height: 250 }

    reportBrowserPanelBounds(a, null, 'chat-a')
    reportBrowserPanelBounds(b, null, 'chat-b')

    expect(setPanelBounds.mock.calls).toEqual([
      [a, null, 'chat-a'],
      [b, null, 'chat-b'],
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
