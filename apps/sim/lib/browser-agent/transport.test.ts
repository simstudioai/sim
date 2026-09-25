import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Native push listeners are registered once by the idempotent transport init;
 * Vitest clears mock call history before every test, so keep them here.
 */
const { pushListeners, register } = vi.hoisted(() => {
  const pushListeners: Record<string, (...args: never[]) => void> = {}
  const register = (name: string) =>
    vi.fn((listener: (...args: never[]) => void) => {
      pushListeners[name] = listener
    })
  return { pushListeners, register }
})

const {
  activateScope,
  capturePanelSnapshot,
  cancelActiveTool,
  cancelTool,
  discardScope,
  disposeScope,
  markScopeSuspended,
  migrateStoreScope,
  nativeMigrateScope,
  executeTool,
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
  openTab,
  openUrl,
  openUrlAvailable,
  panelAction,
  registerSitePermissionPromptSupport,
  reorderTab,
  restoreScope,
  nativeSuspendScope,
  setPageState,
  setPanelBounds,
  setPanelFocused,
  setPanelOccluded,
  setSessionAlive,
  showCredentialChooser,
  showToolbarMenu,
  setTheme,
  setTabsState,
} = vi.hoisted(() => ({
  activateScope: vi.fn(async (scopeId: string) => ({ scopeId, tabs: [], activeTabId: null })),
  capturePanelSnapshot: vi.fn(),
  cancelActiveTool: vi.fn(),
  cancelTool: vi.fn(),
  discardScope: vi.fn(),
  disposeScope: vi.fn(async () => true),
  markScopeSuspended: vi.fn(),
  migrateStoreScope: vi.fn(),
  nativeMigrateScope: vi.fn(),
  executeTool: vi.fn(),
  onPageState: register('pageState'),
  onSessionStatus: register('sessionStatus'),
  onTabsState: register('tabsState'),
  onCloseFind: vi.fn(),
  onAddToChat: vi.fn(),
  onFindResult: vi.fn(),
  onFillAvailability: vi.fn(),
  onFocusOmnibox: vi.fn(),
  onOpenFind: vi.fn(),
  onScopeSuspended: register('scopeSuspended'),
  onToolbarCommand: vi.fn(),
  openTab: vi.fn(),
  openUrl: vi.fn(),
  openUrlAvailable: { current: true },
  panelAction: vi.fn(),
  registerSitePermissionPromptSupport: vi.fn(),
  reorderTab: vi.fn(),
  restoreScope: vi.fn(async (scopeId: string) => ({ scopeId, tabs: [], activeTabId: null })),
  nativeSuspendScope: vi.fn(async () => true),
  setPageState: vi.fn(),
  setPanelBounds: vi.fn(),
  setPanelFocused: vi.fn(),
  setPanelOccluded: vi.fn(),
  setSessionAlive: vi.fn(),
  showCredentialChooser: vi.fn(async () => true),
  showToolbarMenu: vi.fn(),
  setTheme: vi.fn(),
  setTabsState: vi.fn(),
}))

vi.mock('@/lib/desktop', () => ({
  isBrowserAgentEnabled: () => true,
  getDesktopBridge: () => ({
    browserAgent: {
      supportsAtomicPanelOcclusion: true,
      activateScope,
      cancelActiveTool,
      cancelTool,
      executeTool,
      capturePanelSnapshot,
      disposeScope,
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
      openTab,
      openUrl: openUrlAvailable.current ? openUrl : undefined,
      panelAction,
      registerSitePermissionPromptSupport,
      reorderTab,
      restoreScope,
      suspendScope: nativeSuspendScope,
      setPanelBounds,
      setPanelFocused,
      setPanelOccluded,
      showToolbarMenu,
      setTheme,
    },
    browserCredentials: {
      onFillAvailability,
      showChooser: showCredentialChooser,
    },
  }),
}))

vi.mock('@/stores/browser-session/store', () => ({
  useBrowserSessionStore: {
    getState: () => ({
      activeScopeId: null,
      activateScope,
      discardScope,
      migrateScope: migrateStoreScope,
      suspendScope: markScopeSuspended,
      setPageState,
      setSessionAlive,
      setTabsState,
    }),
  },
}))

import {
  activateBrowserScope,
  cancelActiveBrowserTools,
  executeBrowserTool,
  initBrowserAgentTransport,
  migrateBrowserScope,
  onBrowserAddToChat,
  onBrowserFillAvailability,
  onBrowserFindClose,
  onBrowserFindOpen,
  onBrowserFindResult,
  onBrowserOmniboxFocus,
  onBrowserToolbarCommand,
  openUrlInNewBrowserTab,
  restoreBrowserScope,
  showBrowserToolbarMenu,
  suspendBrowserScope,
} from '@/lib/browser-agent/transport'

describe('browser panel transport', () => {
  beforeEach(async () => {
    await activateBrowserScope('chat-test')
    setPanelBounds.mockClear()
    setPanelFocused.mockClear()
    capturePanelSnapshot.mockReset()
    setPanelOccluded.mockReset()
    setPageState.mockClear()
    setSessionAlive.mockClear()
    setTabsState.mockClear()
    restoreScope.mockClear()
    nativeSuspendScope.mockReset()
    nativeSuspendScope.mockResolvedValue(true)
    markScopeSuspended.mockClear()
    migrateStoreScope.mockClear()
    nativeMigrateScope.mockReset()
    cancelActiveTool.mockReset()
    cancelActiveTool.mockResolvedValue(true)
    cancelTool.mockReset()
    cancelTool.mockResolvedValue(true)
    executeTool.mockReset()
    panelAction.mockClear()
    openTab.mockReset()
    openUrl.mockReset()
    openUrlAvailable.current = true
    showToolbarMenu.mockClear()
    onToolbarCommand.mockClear()
    onAddToChat.mockClear()
    onFillAvailability.mockClear()
    setTheme.mockClear()
    discardScope.mockClear()
    disposeScope.mockClear()
  })

  it('opens chat URLs through one acknowledged native operation', async () => {
    openUrl.mockResolvedValue({
      scopeId: 'chat-test',
      activeTabId: '2',
      tabs: [],
    })

    await openUrlInNewBrowserTab('https://example.com/docs', 'chat-test')

    expect(openUrl).toHaveBeenCalledWith('https://example.com/docs', 'chat-test')
    expect(openTab).not.toHaveBeenCalled()
    expect(panelAction).not.toHaveBeenCalled()
    expect(setTabsState).toHaveBeenCalledWith({
      scopeId: 'chat-test',
      activeTabId: '2',
      tabs: [],
    })
  })

  it('falls back to acknowledged tab creation on older installed shells', async () => {
    openUrlAvailable.current = false
    openTab.mockResolvedValue({
      scopeId: 'chat-test',
      activeTabId: '2',
      tabs: [],
    })

    await openUrlInNewBrowserTab('https://example.com/docs', 'chat-test')

    expect(openTab).toHaveBeenCalledWith('chat-test')
    expect(panelAction).toHaveBeenCalledWith(
      { action: 'navigate', url: 'https://example.com/docs' },
      'chat-test'
    )
    expect(setTabsState).toHaveBeenCalledWith({
      scopeId: 'chat-test',
      activeTabId: '2',
      tabs: [],
    })
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

  it('cancels a detached native tool by its captured scope without an AbortController', async () => {
    let settleNative: (response: { ok: boolean; error?: string }) => void = () => {}
    executeTool.mockImplementation(
      () =>
        new Promise((resolve) => {
          settleNative = resolve
        })
    )
    const onCancel = vi.fn()
    const execution = executeBrowserTool(
      'tool-detached',
      'browser_request_takeover',
      { reason: 'Please sign in' },
      null,
      'chat-detached',
      onCancel
    )
    await Promise.resolve()

    await cancelActiveBrowserTools(['chat-detached'])

    expect(onCancel).toHaveBeenCalledOnce()
    expect(cancelTool).toHaveBeenCalledWith('tool-detached', 'chat-detached')
    expect(cancelActiveTool).toHaveBeenCalledWith('chat-detached')
    settleNative({ ok: false, error: 'cancelled' })
    await expect(execution).rejects.toThrow('cancelled')
  })

  it('clears the response watchdog when a browser tool settles early', async () => {
    vi.useFakeTimers()
    try {
      executeTool.mockResolvedValue({ ok: true, result: { done: true } })
      const timersBefore = vi.getTimerCount()

      await expect(
        executeBrowserTool('tool-fast', 'browser_snapshot', {}, 30_000, 'chat-fast')
      ).resolves.toEqual({ done: true })

      expect(vi.getTimerCount()).toBe(timersBefore)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels the exact native tool when the renderer response watchdog expires', async () => {
    vi.useFakeTimers()
    let settleNative: (response: { ok: boolean; error?: string }) => void = () => {}
    try {
      executeTool.mockImplementation(
        () =>
          new Promise((resolve) => {
            settleNative = resolve
          })
      )
      const onCancel = vi.fn()
      const execution = executeBrowserTool(
        'tool-timeout',
        'browser_snapshot',
        {},
        1_000,
        'chat-timeout',
        onCancel
      )
      const timedOut = expect(execution).rejects.toThrow(
        'The browser did not respond within 1000ms. Its outcome is unknown'
      )

      await vi.advanceTimersByTimeAsync(1_000)

      await timedOut
      expect(cancelTool).toHaveBeenCalledWith('tool-timeout', 'chat-timeout')
      expect(onCancel).not.toHaveBeenCalled()
    } finally {
      settleNative({ ok: false, error: 'cancelled' })
      vi.useRealTimers()
    }
  })

  it('starts the native scope boundary without waiting for exact cancellation', async () => {
    let settleNative: (response: { ok: boolean; error?: string }) => void = () => {}
    let settleExactCancellation: (cancelled: boolean) => void = () => {}
    executeTool.mockImplementation(
      () =>
        new Promise((resolve) => {
          settleNative = resolve
        })
    )
    cancelTool.mockImplementation(
      () =>
        new Promise((resolve) => {
          settleExactCancellation = resolve
        })
    )
    const execution = executeBrowserTool(
      'tool-boundary',
      'browser_request_takeover',
      { reason: 'Please sign in' },
      null,
      'chat-boundary'
    )
    await Promise.resolve()

    const stopping = cancelActiveBrowserTools(['chat-boundary'])
    await Promise.resolve()

    expect(cancelTool).toHaveBeenCalledWith('tool-boundary', 'chat-boundary')
    expect(cancelActiveTool).toHaveBeenCalledWith('chat-boundary')

    settleExactCancellation(true)
    await stopping
    settleNative({ ok: false, error: 'cancelled' })
    await expect(execution).rejects.toThrow('cancelled')
  })

  it('moves active tool ownership when a pending browser scope migrates', async () => {
    let settleNative: (response: { ok: boolean; error?: string }) => void = () => {}
    executeTool.mockImplementation(
      () =>
        new Promise((resolve) => {
          settleNative = resolve
        })
    )
    nativeMigrateScope.mockResolvedValue({
      scopeId: 'chat-real',
      tabs: [],
      activeTabId: null,
    })
    const execution = executeBrowserTool(
      'tool-migrated',
      'browser_request_takeover',
      { reason: 'Please sign in' },
      null,
      'pending:new'
    )
    await Promise.resolve()

    await migrateBrowserScope('pending:new', 'chat-real')
    await cancelActiveBrowserTools(['chat-real'])

    expect(cancelTool).toHaveBeenCalledWith('tool-migrated', 'chat-real')
    settleNative({ ok: false, error: 'cancelled' })
    await expect(execution).rejects.toThrow('cancelled')
  })

  it('uses takeover hand-back when the installed shell cannot cancel exact tools', async () => {
    let settleNative: (response: { ok: boolean; result?: unknown }) => void = () => {}
    executeTool.mockImplementation(
      () =>
        new Promise((resolve) => {
          settleNative = resolve
        })
    )
    cancelTool.mockResolvedValue(false)
    const execution = executeBrowserTool(
      'tool-old-shell',
      'browser_request_takeover',
      { reason: 'Please sign in' },
      null,
      'chat-old-shell'
    )
    await Promise.resolve()

    await cancelActiveBrowserTools(['chat-old-shell'])

    expect(panelAction).toHaveBeenCalledWith({ action: 'takeover-done' }, 'chat-old-shell')
    settleNative({ ok: true, result: { completed: true } })
    await expect(execution).resolves.toEqual({ completed: true })
  })

  it('cancels the active native scope when renderer tool ownership was lost on reload', async () => {
    await cancelActiveBrowserTools(['chat-reloaded'])

    expect(cancelTool).not.toHaveBeenCalled()
    expect(cancelActiveTool).toHaveBeenCalledWith('chat-reloaded')
    expect(panelAction).not.toHaveBeenCalled()
  })

  it('hands back a reloaded takeover when the installed shell lacks scope cancellation', async () => {
    cancelActiveTool.mockResolvedValue(false)

    await cancelActiveBrowserTools(['chat-old-reloaded'])

    expect(panelAction).toHaveBeenCalledWith({ action: 'takeover-done' }, 'chat-old-reloaded')
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
        },
      ],
      activeTabId: '1',
    }
    restoreScope.mockResolvedValue(tabsState)

    await expect(restoreBrowserScope('chat-restored')).resolves.toBe(true)

    expect(restoreScope).toHaveBeenCalledWith('chat-restored')
    expect(setTabsState).toHaveBeenCalledWith(tabsState)
  })

  it('routes late browser events to the scope carried by the event', () => {
    initBrowserAgentTransport()
    const pageListener = pushListeners.pageState as (state: {
      tabId: string
      scopeId: string
      url: string
      title: string
      loading: boolean
      canGoBack: boolean
      canGoForward: boolean
    }) => void
    const tabsListener = pushListeners.tabsState as (state: {
      scopeId: string
      tabs: []
      activeTabId: null
    }) => void
    const statusListener = pushListeners.sessionStatus as (alive: boolean, scopeId?: string) => void
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

    expect(setPageState).toHaveBeenCalledWith(pageState)
    expect(setTabsState).toHaveBeenCalledWith(tabsState)
    expect(setSessionAlive).toHaveBeenCalledWith(false, 'chat-c')
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
