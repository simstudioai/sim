import type { MenuItemConstructorOptions } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { BrowserWindow, Menu } from 'electron'
import * as cdp from '@/main/browser-agent/cdp'
import * as driverModule from '@/main/browser-agent/driver'
import * as session from '@/main/browser-agent/session'
import { fillCoordinator } from '@/main/browser-credentials'
import type { BrowserSessionSnapshot } from '@/main/desktop-chat-session-store'

type DriverModule = typeof import('@/main/browser-agent/driver')

/**
 * `initDriver` is a full reset of the driver's and the session's per-session
 * state, so a clean driver needs no module reload — which is what lets this
 * file use static imports instead of the `vi.resetModules()` the root
 * CLAUDE.md forbids. Tests needing real callbacks call `initDriver` again;
 * calling it twice is exactly the re-init case the reset exists for.
 */
function freshDriver(): DriverModule {
  driverModule.initDriver(
    {
      onPageState: vi.fn(),
      onTabsState: vi.fn(),
      onSessionStatus: vi.fn(),
      onFillAvailability: vi.fn(),
    },
    () => null
  )
  driverModule.activateBrowserScope('chat-test')
  return driverModule
}

/** Match the serialized function invocation, not comments or helper names in its body. */
function isPageCall(expression: string, fnName: string): boolean {
  return expression.includes(`function ${fnName}(`)
}

describe('executeTool', () => {
  let driver: DriverModule

  beforeEach(async () => {
    driver = freshDriver()
  })

  it('returns ok:false instead of throwing for tool-level failures', async () => {
    // No session exists, so any page-dependent tool fails with guidance.
    const result = await driver.executeTool('chat-test', 'browser_click', { elementId: 1 })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/No page is open yet/)
  })

  it('validates navigation URLs before touching the session', async () => {
    const result = await driver.executeTool('chat-test', 'browser_navigate', {
      url: 'file:///etc/passwd',
    })
    expect(result).toEqual({
      ok: false,
      error: 'URL must be absolute and start with http:// or https://',
    })
  })

  it('reports missing required parameters by name', async () => {
    const result = await driver.executeTool('chat-test', 'browser_navigate', {})
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Missing required parameter "url"/)
  })

  it('reports an aborted navigation when Chromium never leaves the current URL', async () => {
    vi.useFakeTimers()
    try {
      await driver.executeTool('chat-test', 'browser_open_tab', {})
      const contents = session.requireTab().view.webContents
      vi.mocked(contents.getURL).mockReturnValue('http://127.0.0.1/old')
      vi.mocked(contents.loadURL).mockRejectedValue(
        Object.assign(new Error('net::ERR_ABORTED'), { code: 'ERR_ABORTED' })
      )

      const navigation = driver.executeTool('chat-test', 'browser_navigate', {
        url: 'http://127.0.0.1/new',
      })
      await vi.advanceTimersByTimeAsync(200)

      await expect(navigation).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('navigation was aborted'),
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('accepts ERR_ABORTED only when a replacement navigation changed the URL', async () => {
    vi.useFakeTimers()
    try {
      await driver.executeTool('chat-test', 'browser_open_tab', {})
      const contents = session.requireTab().view.webContents
      let currentUrl = 'http://127.0.0.1/old'
      vi.mocked(contents.getURL).mockImplementation(() => currentUrl)
      vi.mocked(contents.loadURL).mockImplementation(async () => {
        currentUrl = 'http://127.0.0.1/replacement'
        throw Object.assign(new Error('net::ERR_ABORTED'), { code: 'ERR_ABORTED' })
      })

      const navigation = driver.executeTool('chat-test', 'browser_navigate', {
        url: 'http://127.0.0.1/new',
      })
      await vi.advanceTimersByTimeAsync(1_000)

      await expect(navigation).resolves.toMatchObject({
        ok: true,
        result: { url: 'http://127.0.0.1/replacement' },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports non-abort navigation failures instead of treating dispatch as success', async () => {
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    const contents = session.requireTab().view.webContents
    vi.mocked(contents.loadURL).mockRejectedValue(
      Object.assign(new Error('net::ERR_NAME_NOT_RESOLVED'), { code: 'ERR_NAME_NOT_RESOLVED' })
    )

    const result = await driver.executeTool('chat-test', 'browser_navigate', {
      url: 'http://127.0.0.1/unavailable',
    })

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('ERR_NAME_NOT_RESOLVED'),
    })
  })

  it('serializes tool calls: a queued failure never rejects the next call', async () => {
    const first = await driver.executeTool('chat-test', 'browser_snapshot', {})
    expect(first.ok).toBe(false)
    const second = await driver.executeTool('chat-test', 'browser_list_tabs', {})
    // list_tabs works without a session (empty list).
    expect(second.ok).toBe(true)
    expect(second.result).toMatchObject({ tabs: [] })
  })

  it('keeps a takeover pending when the clock advances beyond twelve hours', async () => {
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    vi.useFakeTimers()
    const now = vi.spyOn(Date, 'now').mockReturnValue(0)
    try {
      let settled = false
      const takeover = driver
        .executeTool('chat-test', 'browser_request_takeover', {
          reason: 'Please finish in the browser',
        })
        .then((result) => {
          settled = true
          return result
        })

      await vi.advanceTimersByTimeAsync(0)
      now.mockReturnValue(13 * 60 * 60 * 1000)
      await vi.advanceTimersByTimeAsync(1_500)
      expect(settled).toBe(false)

      await driver.handlePanelAction('chat-test', { action: 'takeover-done' })
      await vi.advanceTimersByTimeAsync(1_500)
      await expect(takeover).resolves.toMatchObject({
        ok: true,
        result: { completed: true },
      })
    } finally {
      now.mockRestore()
      vi.useRealTimers()
    }
  })

  it('cancels the exact takeover and clears its attention state immediately', async () => {
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    vi.useFakeTimers()
    try {
      const takeover = driver.executeTool(
        'chat-test',
        'browser_request_takeover',
        { reason: 'Please finish in the browser' },
        'tool-takeover'
      )
      await vi.advanceTimersByTimeAsync(0)
      expect(session.getTabsState().automationNeedsAttention).toBe(true)

      expect(driver.cancelTool('chat-test', 'tool-takeover')).toBe(true)
      expect(session.getTabsState().automationNeedsAttention).toBe(false)
      await vi.advanceTimersByTimeAsync(1_500)

      await expect(takeover).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('cancelled'),
      })
      await expect(
        driver.executeTool('chat-test', 'browser_list_tabs', {}, 'tool-takeover')
      ).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('cancelled before it started'),
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not let cancelled takeover cleanup clear a newer takeover', async () => {
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    vi.useFakeTimers()
    try {
      const firstTakeover = driver.executeTool(
        'chat-test',
        'browser_request_takeover',
        { reason: 'First handoff' },
        'tool-takeover-first'
      )
      await vi.advanceTimersByTimeAsync(0)

      expect(driver.cancelTool('chat-test', 'tool-takeover-first')).toBe(true)
      await expect(firstTakeover).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('cancelled'),
      })

      const secondTakeover = driver.executeTool(
        'chat-test',
        'browser_request_takeover',
        { reason: 'Second handoff' },
        'tool-takeover-second'
      )
      await vi.advanceTimersByTimeAsync(0)
      expect(session.getTabsState().automationNeedsAttention).toBe(true)

      // Let the detached first takeover observe cancellation and run finally.
      await vi.advanceTimersByTimeAsync(1_500)
      expect(session.getTabsState().automationNeedsAttention).toBe(true)

      await driver.handlePanelAction('chat-test', { action: 'takeover-done' })
      await vi.advanceTimersByTimeAsync(1_500)
      await expect(secondTakeover).resolves.toMatchObject({
        ok: true,
        result: { completed: true },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('honors cancellation that arrives before the authorized tool invocation', async () => {
    expect(driver.cancelTool('chat-test', 'tool-before-authorization')).toBe(true)

    await expect(
      driver.executeTool('chat-test', 'browser_list_tabs', {}, 'tool-before-authorization')
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('cancelled before it started'),
    })
  })

  it('settles native automation activity immediately when an active tool is cancelled', async () => {
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    vi.useFakeTimers()
    try {
      const waiting = driver.executeTool(
        'chat-test',
        'browser_wait_for',
        { timeoutMs: 120_000 },
        'tool-waiting'
      )
      await vi.advanceTimersByTimeAsync(0)
      expect(session.getTabsState().automationActive).toBe(true)

      expect(driver.cancelActiveTool('chat-test')).toBe(true)
      await vi.advanceTimersByTimeAsync(0)
      expect(session.getTabsState().automationActive).toBe(false)
      await expect(waiting).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('cancelled'),
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels queued pre-boundary tools while allowing later browser work', async () => {
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    vi.useFakeTimers()
    try {
      const waiting = driver.executeTool(
        'chat-test',
        'browser_wait_for',
        { timeoutMs: 120_000 },
        'tool-active'
      )
      await vi.advanceTimersByTimeAsync(0)
      const queuedOpen = driver.executeTool('chat-test', 'browser_open_tab', {}, 'tool-queued')

      expect(driver.cancelActiveTool('chat-test')).toBe(true)

      await expect(waiting).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('cancelled'),
      })
      await expect(queuedOpen).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('cancelled before it started'),
      })
      expect(session.getTabsState().tabs).toHaveLength(1)

      await expect(
        driver.executeTool('chat-test', 'browser_open_tab', {}, 'tool-after-boundary')
      ).resolves.toMatchObject({ ok: true })
      expect(session.getTabsState().tabs).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases an abandoned takeover when a newer browser action arrives', async () => {
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    vi.useFakeTimers()
    try {
      const takeover = driver.executeTool('chat-test', 'browser_request_takeover', {
        reason: 'Please finish in the browser',
      })
      await vi.advanceTimersByTimeAsync(0)

      const listTabs = driver.executeTool('chat-test', 'browser_list_tabs', {})
      await vi.advanceTimersByTimeAsync(1_500)

      await expect(takeover).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('superseded by a newer browser action'),
      })
      await expect(listTabs).resolves.toMatchObject({
        ok: true,
        result: { tabs: expect.any(Array) },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns a free-text takeover instruction to the browser agent', async () => {
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    vi.useFakeTimers()
    try {
      const takeover = driver.executeTool('chat-test', 'browser_request_takeover', {
        reason: 'Please pick a match in the draw',
      })
      await vi.advanceTimersByTimeAsync(0)

      await driver.handlePanelAction('chat-test', {
        action: 'takeover-done',
        takeoverResponse: 'Open the second match',
      })
      await vi.advanceTimersByTimeAsync(1_500)

      await expect(takeover).resolves.toMatchObject({
        ok: true,
        result: {
          completed: true,
          userInstruction: 'Open the second match',
        },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('publishes a settled tab when the main frame finishes before subresources', async () => {
    const onPageState = vi.fn()
    const onTabsState = vi.fn()
    const win = new BrowserWindow()
    driver.initDriver(
      {
        onPageState,
        onTabsState,
        onSessionStatus: vi.fn(),
        onFillAvailability: vi.fn(),
      },
      () => win
    )
    driver.activateBrowserScope('chat-test')
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    const contents = session.requireTab().view.webContents
    const eventHandlers = (contents.on as unknown as ReturnType<typeof vi.fn>).mock.calls
    const startLoad = eventHandlers.find(([eventName]) => eventName === 'did-start-loading')?.[1] as
      | (() => void)
      | undefined
    const finishLoad = eventHandlers.find(([eventName]) => eventName === 'did-finish-load')?.[1] as
      | (() => void)
      | undefined
    vi.mocked(contents.isLoading).mockReturnValue(true)
    vi.mocked(contents.isLoadingMainFrame).mockReturnValue(true)
    startLoad?.()
    onPageState.mockClear()
    onTabsState.mockClear()
    vi.mocked(contents.isLoadingMainFrame).mockReturnValue(false)

    expect(startLoad).toBeTypeOf('function')
    expect(finishLoad).toBeTypeOf('function')
    finishLoad?.()

    expect(onPageState).toHaveBeenLastCalledWith(expect.objectContaining({ loading: false }))
    expect(onTabsState).toHaveBeenLastCalledWith(
      expect.objectContaining({ tabs: [expect.objectContaining({ loading: false })] })
    )
  })

  it('publishes main-frame load failures and retries their uncommitted URL', async () => {
    const onPageState = vi.fn()
    const win = new BrowserWindow()
    driver.initDriver(
      {
        onPageState,
        onTabsState: vi.fn(),
        onSessionStatus: vi.fn(),
        onFillAvailability: vi.fn(),
      },
      () => win
    )
    driver.activateBrowserScope('chat-test')
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    const contents = session.requireTab().view.webContents
    const eventHandlers = (contents.on as unknown as ReturnType<typeof vi.fn>).mock.calls
    const failLoad = eventHandlers.find(([eventName]) => eventName === 'did-fail-load')?.[1] as
      | ((...args: unknown[]) => void)
      | undefined
    const failedUrl = 'http://localhost:3004/login'

    onPageState.mockClear()
    failLoad?.({}, -102, 'ERR_CONNECTION_REFUSED', failedUrl, false)
    failLoad?.({}, -3, 'ERR_ABORTED', failedUrl, true)
    expect(onPageState).not.toHaveBeenCalled()

    failLoad?.({}, -102, 'ERR_CONNECTION_REFUSED', failedUrl, true)

    expect(onPageState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        url: failedUrl,
        issue: {
          kind: 'load-error',
          code: -102,
          description: 'ERR_CONNECTION_REFUSED',
          url: failedUrl,
        },
      })
    )

    vi.mocked(contents.loadURL).mockClear()
    await driver.handlePanelAction('chat-test', { action: 'reload' })
    expect(contents.loadURL).toHaveBeenCalledWith(failedUrl)

    vi.mocked(contents.loadURL).mockClear()
    await driver.executeTool('chat-test', 'browser_go_back', {})
    expect(session.pageIssueForContents(contents)).toBeUndefined()
    expect(session.canGoForward(contents)).toBe(true)

    await driver.executeTool('chat-test', 'browser_go_forward', {})
    expect(contents.loadURL).toHaveBeenCalledWith(failedUrl)
  })

  it('forces fill availability to replay on scope activation and tab switches', async () => {
    const refreshAvailability = vi
      .spyOn(fillCoordinator()!, 'refreshAvailability')
      .mockResolvedValue()

    driver.activateBrowserScope('chat-with-login')
    expect(refreshAvailability).toHaveBeenCalledWith(true)

    await driver.executeTool('chat-with-login', 'browser_open_tab', {})
    await driver.executeTool('chat-with-login', 'browser_open_tab', {})
    refreshAvailability.mockClear()
    session.switchTab('1')

    expect(refreshAvailability).toHaveBeenCalledWith(true)
  })

  it('keeps target-blank initiation user-owned while automation is active', async () => {
    driver = freshDriver()
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    const source = session.requireTab().view.webContents
    session.setAutomationActive(true)
    const beforeMouse = (source.on as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      ([eventName]) => eventName === 'before-mouse-event'
    )?.[1] as (event: unknown, mouse: { type: string }) => void
    beforeMouse({}, { type: 'mouseDown' })
    const openWindow = vi.mocked(source.setWindowOpenHandler).mock.calls[0]?.[0] as (details: {
      url: string
    }) => { action: string }

    expect(openWindow({ url: 'https://user-popup.example/' })).toEqual({ action: 'deny' })
    const popup = session.activeTab()?.view.webContents
    if (!popup) throw new Error('Expected user popup tab')
    expect(session.automationTab()?.view.webContents).toBe(source)
    expect(popup.loadURL).toHaveBeenCalledWith('https://user-popup.example/')
  })

  it('keeps agent-opened target-blank tabs agent-owned after dispatch ends', async () => {
    driver = freshDriver()
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    const source = session.requireTab().view.webContents
    session.setAutomationActive(true)
    const openWindow = vi.mocked(source.setWindowOpenHandler).mock.calls[0]?.[0] as (details: {
      url: string
    }) => { action: string }

    expect(openWindow({ url: 'https://agent-popup.example/' })).toEqual({ action: 'deny' })
    const popup = session.requireAutomationTab().view.webContents
    expect(session.activeTab()?.view.webContents).toBe(source)
    session.setAutomationActive(false)
    expect(session.automationTab()?.view.webContents).toBe(popup)
    expect(popup.loadURL).toHaveBeenCalledWith('https://agent-popup.example/')
  })

  it('keeps context-menu new tabs user-owned while automation is active', async () => {
    driver = freshDriver()
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    const source = session.requireTab().view.webContents
    session.setAutomationActive(true)
    vi.mocked(Menu.buildFromTemplate).mockClear()
    const contextMenu = (source.on as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      ([eventName]) => eventName === 'context-menu'
    )?.[1] as (event: unknown, params: unknown) => void
    contextMenu(
      {},
      {
        selectionText: '',
        linkURL: 'https://context-link.example/',
        isEditable: false,
        editFlags: { canPaste: false },
      }
    )
    const template = vi.mocked(Menu.buildFromTemplate).mock.calls.at(-1)?.[0] as
      | MenuItemConstructorOptions[]
      | undefined
    template
      ?.find((item) => item.label === 'Open Link in New Tab')
      ?.click?.({} as never, undefined as never, {} as never)

    const popup = session.activeTab()?.view.webContents
    if (!popup) throw new Error('Expected context-menu tab')
    expect(session.automationTab()?.view.webContents).toBe(source)
    expect(popup.loadURL).toHaveBeenCalledWith('https://context-link.example/')
  })

  it('builds the native toolbar menu and routes renderer-owned actions back to its chat', async () => {
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    const win = new BrowserWindow()
    vi.mocked(Menu.buildFromTemplate).mockClear()

    expect(driver.showToolbarMenu('chat-test', win, { x: 20, y: 30 })).toBe(true)
    const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0]?.[0] as
      | MenuItemConstructorOptions[]
      | undefined
    const labels = template?.filter((item) => item.type !== 'separator').map((item) => item.label)
    expect(labels).toEqual(['Find in Page', 'Zoom (110%)', 'Import Passwords', 'Browser Settings'])

    const settings = template?.find((item) => item.label === 'Browser Settings')
    const openSettings = settings?.click as (() => void) | undefined
    openSettings?.()
    expect(win.webContents.send).toHaveBeenCalledWith(
      'browser-agent:toolbar-command',
      'browser-settings',
      'chat-test'
    )
  })

  it('routes an exact renderer media decision through the scoped session boundary', async () => {
    const respond = vi.spyOn(session, 'respondToMediaPermission').mockResolvedValue()

    await driver.handlePanelAction('chat-test', {
      action: 'respond-media-permission',
      requestId: 'request-1',
      allowed: true,
    })
    await driver.handlePanelAction('chat-test', {
      action: 'respond-media-permission',
      requestId: 'request-2',
    })

    expect(respond).toHaveBeenCalledOnce()
    expect(respond).toHaveBeenCalledWith('request-1', true)
  })

  it('keeps tool queues and tab state isolated by chat scope', async () => {
    await driver.executeTool('chat-a', 'browser_open_tab', {})
    await driver.executeTool('chat-a', 'browser_open_tab', {})
    await driver.executeTool('chat-b', 'browser_open_tab', {})

    const chatA = await driver.executeTool('chat-a', 'browser_list_tabs', {})
    const chatB = await driver.executeTool('chat-b', 'browser_list_tabs', {})

    expect(chatA).toMatchObject({
      ok: true,
      result: { scopeId: 'chat-a', activeTabId: '2', tabs: [{ tabId: '1' }, { tabId: '2' }] },
    })
    expect(chatB).toMatchObject({
      ok: true,
      result: { scopeId: 'chat-b', activeTabId: '1', tabs: [{ tabId: '1' }] },
    })
  })

  it('adopts pending tabs over an activation-only durable destination', async () => {
    await driver.executeTool('pending:new-chat', 'browser_open_tab', {})
    driver.activateBrowserScope('chat-real')

    expect(driver.migrateBrowserScope('pending:new-chat', 'chat-real')).toBe(true)
    await expect(driver.executeTool('chat-real', 'browser_list_tabs', {})).resolves.toMatchObject({
      ok: true,
      result: { scopeId: 'chat-real', tabs: [{ tabId: '1' }] },
    })

    await driver.executeTool('pending:other-chat', 'browser_open_tab', {})
    await driver.executeTool('chat-occupied', 'browser_open_tab', {})
    expect(driver.migrateBrowserScope('pending:other-chat', 'chat-occupied')).toBe(false)
  })

  it('keeps activation lazy, then restores and disposes through the driver API', async () => {
    const snapshot: BrowserSessionSnapshot = {
      v: 1,
      tabs: [{ url: 'https://restored.example/', pinned: false }],
      activeIndex: 0,
      downloads: [],
    }
    const load = vi.fn(() => snapshot)
    const disposeScope = vi.fn()
    driver.initDriver(
      {
        onPageState: vi.fn(),
        onTabsState: vi.fn(),
        onSessionStatus: vi.fn(),
        onFillAvailability: vi.fn(),
      },
      () => null,
      undefined,
      {
        load,
        save: vi.fn(() => true),
        migrateScope: vi.fn(() => true),
        disposeScope,
      }
    )

    driver.activateBrowserScope('chat-restored')
    expect(load).not.toHaveBeenCalled()
    expect(session.withBrowserScope('chat-restored', () => session.peekTabsState().tabs)).toEqual(
      []
    )

    const listed = driver.restoreBrowserScope('chat-restored')
    expect(load).toHaveBeenCalledWith('chat-restored')
    expect(listed).toMatchObject({
      tabs: [{ url: 'https://restored.example/' }],
    })
    const restoredTab = session.withBrowserScope('chat-restored', () => session.activeTab())

    driver.disposeBrowserScope('chat-restored')
    expect(restoredTab?.view.webContents.close).toHaveBeenCalled()
    expect(disposeScope).toHaveBeenCalledWith('chat-restored')
  })

  it.each(['', 'about:blank'])(
    'fails page tools immediately and releases queued tab listing when the URL is %j',
    async (url) => {
      const win = new BrowserWindow()
      driver.initDriver(
        {
          onPageState: vi.fn(),
          onTabsState: vi.fn(),
          onSessionStatus: vi.fn(),
          onFillAvailability: vi.fn(),
        },
        () => win
      )
      driver.activateBrowserScope('chat-test')
      await driver.executeTool('chat-test', 'browser_open_tab', {})

      const contents = session.requireTab().view.webContents
      vi.mocked(contents.getURL).mockReturnValue(url)
      vi.mocked(contents.executeJavaScript).mockImplementation(() => new Promise<never>(() => {}))

      const snapshot = driver.executeTool('chat-test', 'browser_snapshot', {})
      const listTabs = driver.executeTool('chat-test', 'browser_list_tabs', {})

      await expect(snapshot).resolves.toEqual({
        ok: false,
        error:
          'The active tab is blank. Call browser_navigate before using page inspection or interaction tools.',
      })
      await expect(listTabs).resolves.toMatchObject({
        ok: true,
        result: {
          tabs: [{ url }],
        },
      })
      expect(contents.executeJavaScript).not.toHaveBeenCalled()
    }
  )

  it('leaves no watchdog timer pending once a tool finishes', async () => {
    vi.useFakeTimers()
    try {
      // Racing against an uncancellable sleep left one timer alive per call for
      // the full watchdog window — up to two minutes, dozens deep in a run.
      const before = vi.getTimerCount()
      await driver.executeTool('chat-test', 'browser_list_tabs', {})

      expect(vi.getTimerCount()).toBe(before)
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases the serialized queue before the renderer timeout when a page call hangs', async () => {
    vi.useFakeTimers()
    try {
      const win = new BrowserWindow()
      driver.initDriver(
        {
          onPageState: vi.fn(),
          onTabsState: vi.fn(),
          onSessionStatus: vi.fn(),
          onFillAvailability: vi.fn(),
        },
        () => win
      )
      driver.activateBrowserScope('chat-test')
      await driver.executeTool('chat-test', 'browser_open_tab', {})

      const contents = session.requireTab().view.webContents
      vi.mocked(contents.executeJavaScript).mockImplementation(() => new Promise<never>(() => {}))

      const hung = driver.executeTool('chat-test', 'browser_snapshot', {})
      const queued = driver.executeTool('chat-test', 'browser_list_tabs', {})
      await vi.advanceTimersByTimeAsync(20_000)

      await expect(hung).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('did not finish this action in time'),
      })
      await expect(queued).resolves.toMatchObject({
        ok: true,
        result: { tabs: expect.any(Array) },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('sanitizes hostile tab titles before returning them across the tool boundary', async () => {
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    const contents = session.requireTab().view.webContents
    vi.mocked(contents.getTitle).mockReturnValue(`bad\0\uD800${'x'.repeat(600)}`)

    const listed = await driver.executeTool('chat-test', 'browser_list_tabs', {})
    const title = (listed.result as { tabs: Array<{ title: string }> }).tabs[0]?.title ?? ''

    expect(title).toHaveLength(500)
    expect(title).not.toContain('\0')
    expect(title).not.toMatch(/[\uD800-\uDFFF]/)
    expect(title).toContain('\uFFFD')
  })

  it('rejects snapshot refs whose structural line evidence is missing', async () => {
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    const contents = session.requireTab().view.webContents
    vi.mocked(contents.getURL).mockReturnValue('https://example.com/')
    vi.mocked(contents.executeJavaScript).mockResolvedValue({
      url: 'https://example.com/',
      title: 'Example',
      outline: '- button "Visible" [ref=0]',
      truncated: false,
      refIds: [0],
      refLineIndexes: { 0: 99 },
      nextElementId: 1,
    })

    await expect(driver.executeTool('chat-test', 'browser_snapshot', {})).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('invalid element ids'),
    })
    await expect(
      driver.executeTool('chat-test', 'browser_click', { elementId: 0 })
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('Element ids are not valid'),
    })
    expect(contents.debugger.sendCommand).not.toHaveBeenCalledWith(
      'Input.dispatchMouseEvent',
      expect.anything()
    )
  })

  it('does not let a snapshot that resolves after timeout overwrite newer refs', async () => {
    vi.useFakeTimers()
    try {
      await driver.executeTool('chat-test', 'browser_open_tab', {})
      const contents = session.requireTab().view.webContents
      vi.mocked(contents.getURL).mockReturnValue('https://example.com/')
      let resolveLate: ((value: unknown) => void) | undefined
      let snapshotCalls = 0
      vi.mocked(contents.executeJavaScript).mockImplementation((expression: string) => {
        if (!isPageCall(expression, 'collectSnapshot')) return Promise.resolve(undefined)
        snapshotCalls++
        if (snapshotCalls === 1) {
          return new Promise((resolve) => {
            resolveLate = resolve
          })
        }
        return Promise.resolve({
          url: 'https://example.com/',
          title: 'Fresh',
          outline: '- button "Fresh" [ref=10]',
          truncated: false,
          refIds: [10],
          refLineIndexes: { 10: 0 },
          nextElementId: 11,
        })
      })

      const late = driver.executeTool('chat-test', 'browser_snapshot', {})
      await vi.advanceTimersByTimeAsync(20_000)
      await expect(late).resolves.toMatchObject({ ok: false })
      await expect(driver.executeTool('chat-test', 'browser_snapshot', {})).resolves.toMatchObject({
        ok: true,
      })

      resolveLate?.({
        url: 'https://example.com/',
        title: 'Late',
        outline: '- button "Late" [ref=0]',
        truncated: false,
        refIds: [0],
        refLineIndexes: { 0: 0 },
        nextElementId: 1,
      })
      await Promise.resolve()
      await Promise.resolve()

      await expect(
        driver.executeTool('chat-test', 'browser_click', { elementId: 0 })
      ).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('not present in the current snapshot'),
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('merges cross-origin structure and routes its refs through production frame isolation', async () => {
    const win = new BrowserWindow()
    driver.initDriver(
      {
        onPageState: vi.fn(),
        onTabsState: vi.fn(),
        onSessionStatus: vi.fn(),
        onFillAvailability: vi.fn(),
      },
      () => win
    )
    driver.activateBrowserScope('chat-test')
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    const contents = session.requireTab().view.webContents
    vi.mocked(contents.getURL).mockReturnValue('https://mail.google.com/mail/u/0/#inbox')
    vi.mocked(contents.executeJavaScript).mockImplementation((expression: string) => {
      if (isPageCall(expression, 'readPageText')) {
        return Promise.resolve({
          url: 'https://mail.google.com/mail/u/0/#inbox',
          title: 'Inbox',
          text: 'Primary inbox',
          truncated: false,
        })
      }
      return Promise.resolve({
        url: 'https://mail.google.com/mail/u/0/#inbox',
        title: 'Inbox',
        outline: '- link "Inbox" [ref=0]',
        truncated: false,
        refIds: [0],
        refLineIndexes: { 0: 0 },
        nextElementId: 1,
      })
    })

    let frameActionReads = 0
    const mainFrame = {
      frameTreeNodeId: 1,
      detached: false,
      isDestroyed: vi.fn(() => false),
      name: '',
      origin: 'https://mail.google.com',
      url: 'https://mail.google.com/mail/u/0/#inbox',
      parent: null,
      frames: [] as unknown[],
      framesInSubtree: [] as unknown[],
      executeJavaScript: vi.fn((expression: string) => {
        if (isPageCall(expression, 'readChildFrameElementState')) {
          if (expression.includes('hidden-frame')) {
            return Promise.resolve({ known: true, visible: false })
          }
          if (expression.includes('unreadable-frame')) {
            return Promise.resolve({ known: false, visible: false })
          }
          return Promise.resolve({
            known: true,
            visible: true,
            mappedX: 24,
            mappedY: 48,
            pointMappingReliable: true,
          })
        }
        return Promise.resolve(undefined)
      }),
    }
    const hiddenFrame = {
      detached: false,
      isDestroyed: vi.fn(() => false),
      name: 'hidden-frame',
      origin: 'https://hidden.example',
      url: 'https://hidden.example/widget',
      parent: mainFrame,
      frames: [] as unknown[],
      executeJavaScript: vi.fn(),
    }
    const unreadableFrame = {
      detached: false,
      isDestroyed: vi.fn(() => false),
      name: 'unreadable-frame',
      origin: 'https://unreadable.example',
      url: 'https://unreadable.example/widget',
      parent: mainFrame,
      frames: [] as unknown[],
      executeJavaScript: vi.fn(),
    }
    const crossFrame = {
      frameTreeNodeId: 2,
      detached: false,
      isDestroyed: vi.fn(() => false),
      name: 'google-apps',
      origin: 'https://ogs.google.com',
      url: 'https://ogs.google.com/u/0/widget/app',
      parent: mainFrame,
      executeJavaScript: vi.fn((expression: string) => {
        if (isPageCall(expression, 'collectSnapshot')) {
          return Promise.resolve({
            url: 'https://ogs.google.com/u/0/widget/app',
            title: 'Google apps',
            outline: '- link "Drive" [ref=1]\n- textbox "Search apps" [ref=2]',
            truncated: false,
            refIds: [1, 2],
            refLineIndexes: { 1: 0, 2: 1 },
            nextElementId: 3,
          })
        }
        if (isPageCall(expression, 'readPageText')) {
          return Promise.resolve({
            url: 'https://ogs.google.com/u/0/widget/app',
            title: 'Google apps',
            text: `Drive Calendar Account ${'x'.repeat(6_000)}`,
            truncated: false,
          })
        }
        if (isPageCall(expression, 'clickElement')) {
          return Promise.resolve({
            dispatched: false,
            x: 24,
            y: 48,
            element: 'Drive',
            refRecovered: false,
          })
        }
        if (isPageCall(expression, 'scrollPage')) {
          return Promise.resolve({
            direction: 'down',
            requestedAmount: 500,
            target: 'Apps list',
            targetSource: 'element',
            movedBy: 500,
            scrollTop: 500,
            scrollHeight: 1_500,
            clientHeight: 500,
            atTop: false,
            atBottom: false,
          })
        }
        if (isPageCall(expression, 'focusElementForTyping')) {
          return Promise.resolve({ focused: true, kind: 'input', x: 24, y: 48 })
        }
        if (isPageCall(expression, 'activeElementSecrecy')) return Promise.resolve('safe')
        if (isPageCall(expression, 'readActiveElementState')) return Promise.resolve({})
        if (isPageCall(expression, 'readPageActionState')) {
          frameActionReads++
          return Promise.resolve({
            url: 'https://ogs.google.com/u/0/widget/app',
            title: 'Google apps',
            focus: frameActionReads === 1 ? 'body' : 'a:link:::Drive',
            mutationRevision: frameActionReads === 1 ? 0 : 1,
            dialogs: [],
            scroll: [0],
          })
        }
        return Promise.resolve(undefined)
      }),
    }
    mainFrame.frames = [crossFrame, hiddenFrame, unreadableFrame]
    mainFrame.framesInSubtree = [mainFrame, crossFrame, hiddenFrame, unreadableFrame]
    Object.defineProperty(contents, 'mainFrame', { configurable: true, value: mainFrame })
    Object.defineProperty(contents, 'focusedFrame', { configurable: true, value: crossFrame })
    const isolatedFrameEval = vi
      .spyOn(cdp, 'evaluateInIsolatedFrame')
      .mockImplementation((_contents, frame, expression) => {
        if ((frame as unknown) === mainFrame) return mainFrame.executeJavaScript(expression)
        if ((frame as unknown) === crossFrame) return crossFrame.executeJavaScript(expression)
        return Promise.reject(new Error('unexpected isolated frame target'))
      })

    const snapshot = await driver.executeTool('chat-test', 'browser_snapshot', {})
    const textResult = await driver.executeTool('chat-test', 'browser_read_text', {})
    const scroll = await driver.executeTool('chat-test', 'browser_scroll', {
      direction: 'down',
      amount: 500,
      elementId: 1,
    })
    const click = await driver.executeTool('chat-test', 'browser_click', { elementId: 1 })
    const typed = await driver.executeTool('chat-test', 'browser_type', {
      elementId: 2,
      text: 'drive',
    })

    expect(snapshot).toMatchObject({
      ok: true,
      result: {
        outline: expect.stringContaining('cross-origin iframe "Google apps"'),
        capturedCrossOriginFrames: 1,
        unreadableCrossOriginFrames: 1,
        hiddenCrossOriginFrames: 1,
      },
    })
    expect(snapshot).toMatchObject({
      result: { outline: expect.stringContaining('link "Drive" [ref=1]') },
    })
    expect(snapshot.result).not.toHaveProperty('browserProtocolVersion')
    expect(snapshot.result).not.toHaveProperty('capabilities')
    expect(textResult).toMatchObject({
      ok: true,
      result: {
        text: expect.stringContaining('Drive Calendar Account'),
        framesRead: 1,
        unreadableFrames: 1,
        hiddenFrames: 1,
        truncated: true,
      },
    })
    expect((textResult.result as { text: string }).text.length).toBeLessThanOrEqual(30_000)
    expect(scroll).toMatchObject({
      ok: true,
      result: {
        target: 'Apps list',
        targetSource: 'element',
        movedBy: 500,
        atBottom: false,
      },
    })
    expect(click).toMatchObject({
      ok: true,
      result: { dispatched: true, trusted: true, element: 'Drive', effectObserved: false },
    })
    expect(typed).toMatchObject({
      ok: true,
      result: { dispatched: true, trusted: true, effectObserved: false },
    })
    expect(click.result).not.toHaveProperty('clicked')
    expect(typed.result).not.toHaveProperty('typed')
    expect(
      vi
        .mocked(contents.debugger.sendCommand)
        .mock.calls.filter(([method]) => method === 'Input.insertText')
    ).toHaveLength(1)
    expect(isolatedFrameEval).toHaveBeenCalledWith(contents, crossFrame, expect.any(String), false)
    isolatedFrameEval.mockRestore()
  })
})

/**
 * Trusted CDP input never enters the page, so a focused credential field can
 * only be ruled out in the driver. These cover that seam; the page-side
 * detection itself is covered in page-functions.test.ts.
 */
describe('credential protection', () => {
  let driver: DriverModule

  beforeEach(async () => {
    driver = freshDriver()
  })

  /** Opens a tab on a real URL so injected page calls are not short-circuited. */
  async function openPage() {
    const win = new BrowserWindow()
    driver.initDriver(
      {
        onPageState: vi.fn(),
        onTabsState: vi.fn(),
        onSessionStatus: vi.fn(),
        onFillAvailability: vi.fn(),
      },
      () => win
    )
    driver.activateBrowserScope('chat-test')
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    const contents = session.requireTab().view.webContents
    vi.mocked(contents.getURL).mockReturnValue('https://example.com/login')
    vi.mocked(contents.executeJavaScript).mockImplementation((expression: string) => {
      if (isPageCall(expression, 'collectSnapshot')) {
        return Promise.resolve({
          url: 'https://example.com/login',
          title: 'Example',
          outline: '- button "Test" [ref=0]',
          truncated: false,
          refIds: [0],
          refLineIndexes: { 0: 0 },
          nextElementId: 1,
        })
      }
      return Promise.resolve(undefined)
    })
    await driver.executeTool('chat-test', 'browser_snapshot', {})
    return contents
  }

  /**
   * Routes injected calls by the function name in the serialized source, so a
   * test can say what each page probe reports.
   */
  function respondWith(
    contents: Awaited<ReturnType<typeof openPage>>,
    replies: Record<string, unknown>
  ): void {
    vi.mocked(contents.executeJavaScript).mockImplementation((expression: string) => {
      for (const [fnName, value] of Object.entries(replies)) {
        if (isPageCall(expression, fnName)) return Promise.resolve(value)
      }
      if (isPageCall(expression, 'clickElement')) {
        return Promise.resolve({ dispatched: false, x: 24, y: 48, element: 'Test' })
      }
      return Promise.resolve(undefined)
    })
  }

  function cdpCalls(contents: Awaited<ReturnType<typeof openPage>>, method: string): unknown[][] {
    return vi
      .mocked(contents.debugger.sendCommand)
      .mock.calls.filter(([called]) => called === method)
  }

  it('refuses a keystroke while a password field holds focus', async () => {
    const contents = await openPage()
    respondWith(contents, { activeElementSecrecy: 'secret' })

    const result = await driver.executeTool('chat-test', 'browser_press_key', { key: 'a' })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Refusing to act on a password field/)
    expect(cdpCalls(contents, 'Input.dispatchKeyEvent')).toHaveLength(0)
  })

  it('refuses character insertion into a frame it cannot inspect', async () => {
    const contents = await openPage()
    respondWith(contents, { activeElementSecrecy: 'opaque' })

    const result = await driver.executeTool('chat-test', 'browser_press_key', { key: 'a' })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/cross-origin frame/)
    expect(cdpCalls(contents, 'Input.dispatchKeyEvent')).toHaveLength(0)
  })

  it('still allows caret and dismissal keys in a frame it cannot inspect', async () => {
    const contents = await openPage()
    respondWith(contents, { activeElementSecrecy: 'opaque', readActiveElementState: {} })

    const result = await driver.executeTool('chat-test', 'browser_press_key', { key: 'Escape' })

    expect(result.ok).toBe(true)
    expect(cdpCalls(contents, 'Input.dispatchKeyEvent').length).toBeGreaterThan(0)
  })

  it('still dispatches input after the user has interacted with the visible tab', async () => {
    const contents = await openPage()
    respondWith(contents, { activeElementSecrecy: 'safe', readActiveElementState: {} })
    // User interaction claims the visible tab for panel-level ownership
    // (popups, close protection) but must never block agent input.
    session.claimActiveTabForUser()
    expect(session.automationTabClaimedByUser()).toBe(true)

    const result = await driver.executeTool('chat-test', 'browser_press_key', { key: 'a' })

    expect(result.ok).toBe(true)
    expect(cdpCalls(contents, 'Input.dispatchKeyEvent').length).toBeGreaterThan(0)
  })

  it('sends the keystroke when nothing sensitive is focused', async () => {
    const contents = await openPage()
    respondWith(contents, { activeElementSecrecy: 'safe', readActiveElementState: {} })

    const result = await driver.executeTool('chat-test', 'browser_press_key', { key: 'a' })

    expect(result.ok).toBe(true)
    expect(cdpCalls(contents, 'Input.dispatchKeyEvent').length).toBeGreaterThan(0)
  })

  it('reports when a platform-mismatched shortcut produces no observable effect', async () => {
    const contents = await openPage()
    respondWith(contents, {
      activeElementSecrecy: 'safe',
      readActiveElementState: {
        activeElement: 'body',
        selectedChars: 0,
        valueLength: 0,
        valuePreview: '',
      },
      readPageActionState: {
        url: 'https://example.com/login',
        title: 'Example',
        focus: 'body',
        mutationRevision: 0,
        dialogs: [],
        scroll: [0],
      },
    })

    const result = await driver.executeTool('chat-test', 'browser_press_key', { key: 'Control+K' })

    expect(result).toMatchObject({
      ok: true,
      result: {
        pressed: 'Control+K',
        effectObserved: false,
        note: expect.stringContaining('No strong observable page change'),
      },
    })
  })

  it('aborts a type when focus moves to a password field before the insert', async () => {
    const contents = await openPage()
    let focusReads = 0
    vi.mocked(contents.executeJavaScript).mockImplementation((expression: string) => {
      if (isPageCall(expression, 'focusElementForTyping')) {
        focusReads++
        return Promise.resolve(
          focusReads === 1 ? { focused: true, kind: 'input', x: 24, y: 48 } : { error: 'password' }
        )
      }
      if (isPageCall(expression, 'readActiveElementState')) return Promise.resolve({})
      if (isPageCall(expression, 'readPageActionState')) return Promise.resolve({})
      return Promise.resolve(undefined)
    })

    const result = await driver.executeTool('chat-test', 'browser_type', {
      elementId: 0,
      text: 'hunter2',
    })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Refusing to act on a password field/)
    expect(cdpCalls(contents, 'Input.insertText')).toHaveLength(0)
  })

  it('aborts when the suggestions surface steals focus at the final guard', async () => {
    const contents = await openPage()
    let focusReads = 0
    vi.mocked(contents.executeJavaScript).mockImplementation((expression: string) => {
      if (isPageCall(expression, 'focusElementForTyping')) {
        focusReads++
        return Promise.resolve(
          focusReads === 1 ? { focused: true, kind: 'input', x: 24, y: 48 } : { error: 'different' }
        )
      }
      if (isPageCall(expression, 'clickElement')) {
        return Promise.resolve({ dispatched: false, x: 24, y: 48, element: 'Test' })
      }
      if (isPageCall(expression, 'readActiveElementState')) {
        return Promise.resolve({ activeElement: 'input', valueLength: 0 })
      }
      if (isPageCall(expression, 'readPageActionState')) {
        return Promise.resolve({
          url: 'https://example.com/login',
          title: 'Example',
          focus: 'input',
          mutationRevision: 0,
          dialogs: [],
          scroll: [0],
        })
      }
      return Promise.resolve(undefined)
    })

    const result = await driver.executeTool('chat-test', 'browser_type', {
      elementId: 0,
      text: 'hunter2',
    })

    expect(focusReads).toBe(2)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/different field took focus/)
    expect(cdpCalls(contents, 'Input.insertText')).toHaveLength(0)
  })

  it('warns when acknowledged text produces no observable field change', async () => {
    const contents = await openPage()
    respondWith(contents, {
      focusElementForTyping: { focused: true, kind: 'input', x: 24, y: 48 },
      activeElementSecrecy: 'safe',
      readActiveElementState: { activeElement: 'input', valueLength: 7 },
    })

    const result = await driver.executeTool('chat-test', 'browser_type', {
      elementId: 0,
      text: 'hunter2',
    })

    expect(result.ok).toBe(true)
    expect(result).toMatchObject({
      result: {
        effectObserved: false,
        note: expect.stringContaining('field readback did not change'),
      },
    })
    expect(cdpCalls(contents, 'Input.insertText')).toHaveLength(1)
  })

  it('types through a focused combobox suggestions popup without pointer probing', async () => {
    const contents = await openPage()
    respondWith(contents, {
      focusElementForTyping: {
        focused: true,
        kind: 'input',
        x: 24,
        y: 48,
        coveredByRelatedPopup: true,
      },
      readActiveElementState: { activeElement: 'input', valueLength: 0 },
      readPageActionState: {
        url: 'https://example.com/login',
        title: 'Compose',
        focus: 'input:combobox:::To:',
        mutationRevision: 0,
        dialogs: [],
        popups: ['Contact list'],
        scroll: [0],
      },
    })

    const result = await driver.executeTool('chat-test', 'browser_type', {
      elementId: 0,
      text: 'Mondu',
    })

    expect(result).toMatchObject({ ok: true, result: { dispatched: true, trusted: true } })
    expect(cdpCalls(contents, 'Input.insertText')).toHaveLength(1)
    expect(
      vi
        .mocked(contents.executeJavaScript)
        .mock.calls.some(([expression]) => isPageCall(String(expression), 'clickElement'))
    ).toBe(false)
  })

  it('confirms typing only after the field readback changes', async () => {
    const contents = await openPage()
    let inserted = false
    const observedInsertionStates: boolean[] = []
    vi.mocked(contents.debugger.sendCommand).mockImplementation((method) => {
      if (method === 'Input.insertText') inserted = true
      return Promise.resolve({})
    })
    vi.mocked(contents.executeJavaScript).mockImplementation((expression: string) => {
      if (isPageCall(expression, 'focusElementForTyping')) {
        return Promise.resolve({ focused: true, kind: 'input', x: 24, y: 48 })
      }
      if (isPageCall(expression, 'activeElementSecrecy')) return Promise.resolve('safe')
      if (isPageCall(expression, 'clickElement')) {
        return Promise.resolve({ dispatched: false, x: 24, y: 48, element: 'Test' })
      }
      if (isPageCall(expression, 'readActiveElementState')) {
        observedInsertionStates.push(inserted)
        return Promise.resolve({ activeElement: 'input', valueLength: inserted ? 7 : 0 })
      }
      if (isPageCall(expression, 'readPageActionState')) {
        return Promise.resolve({
          url: 'https://example.com/login',
          title: 'Example',
          focus: 'input',
          mutationRevision: 0,
          dialogs: [],
          scroll: [0],
        })
      }
      return Promise.resolve(undefined)
    })

    const result = await driver.executeTool('chat-test', 'browser_type', {
      elementId: 0,
      text: 'hunter2',
    })

    expect(observedInsertionStates).toEqual([false, true])
    expect(result).toMatchObject({
      ok: true,
      result: { dispatched: true, effectObserved: true, effect: { fieldChanged: true } },
    })
    expect(cdpCalls(contents, 'Input.insertText')).toHaveLength(1)
  })

  it.each(['Cmd+V', 'Control+V', 'Cmd+C', 'Cmd+X'])(
    'refuses the clipboard shortcut %s',
    async (key) => {
      const contents = await openPage()
      respondWith(contents, { activeElementSecrecy: 'safe', readActiveElementState: {} })

      const result = await driver.executeTool('chat-test', 'browser_press_key', { key })

      // Paste would move a password copied out of a manager into the page,
      // where the next snapshot reports it as an ordinary field value.
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/clipboard/i)
      expect(cdpCalls(contents, 'Input.dispatchKeyEvent')).toHaveLength(0)
    }
  )

  it('still allows select-all, which carries no clipboard content', async () => {
    const contents = await openPage()
    respondWith(contents, { activeElementSecrecy: 'safe', readActiveElementState: {} })

    const result = await driver.executeTool('chat-test', 'browser_press_key', { key: 'Cmd+A' })

    expect(result.ok).toBe(true)
  })

  it('surfaces the page-side refusal for element-targeted actions', async () => {
    const contents = await openPage()
    respondWith(contents, { clickElement: { error: 'password' } })

    const result = await driver.executeTool('chat-test', 'browser_click', { elementId: 0 })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Refusing to act on a password field/)
  })

  it('guides typing through owned suggestions without dispatching a pointer click', async () => {
    const contents = await openPage()
    respondWith(contents, {
      clickElement: { error: 'suggestions-open', blocker: 'Contact list' },
    })

    const result = await driver.executeTool('chat-test', 'browser_click', { elementId: 0 })

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('Use browser_type on the same element'),
    })
    expect(result.error).toContain('do not dismiss the popup')
    expect(cdpCalls(contents, 'Input.dispatchMouseEvent')).toHaveLength(0)
  })

  it('uses trusted CDP mouse input for element clicks', async () => {
    const contents = await openPage()
    respondWith(contents, {
      clickElement: { dispatched: false, x: 24, y: 48, element: 'Search result' },
      readActiveElementState: {},
      readPageActionState: {
        url: 'https://example.com/login',
        title: 'Example',
        focus: 'body',
        mutationRevision: 0,
        dialogs: [],
        scroll: [0],
      },
    })

    const result = await driver.executeTool('chat-test', 'browser_click', { elementId: 0 })

    expect(result).toMatchObject({
      ok: true,
      result: {
        dispatched: true,
        trusted: true,
        effectObserved: false,
        note: expect.stringContaining('No strong observable page change'),
      },
    })
    expect(cdpCalls(contents, 'Input.dispatchMouseEvent')).toHaveLength(3)
  })

  it('returns the actual inner-container movement from browser_scroll', async () => {
    const contents = await openPage()
    respondWith(contents, {
      scrollPage: {
        direction: 'up',
        requestedAmount: 500,
        target: 'Message history',
        targetSource: 'viewport-center',
        movedBy: -500,
        scrollTop: 1_000,
        scrollHeight: 4_000,
        clientHeight: 800,
        atTop: false,
        atBottom: false,
      },
    })

    const result = await driver.executeTool('chat-test', 'browser_scroll', {
      direction: 'up',
      amount: 500,
    })

    expect(result).toMatchObject({
      ok: true,
      result: {
        target: 'Message history',
        targetSource: 'viewport-center',
        movedBy: -500,
        scrollTop: 1_000,
        atTop: false,
        atBottom: false,
      },
    })
  })

  it('confirms a click when the requested target changes semantic state', async () => {
    const contents = await openPage()
    let actionReads = 0
    vi.mocked(contents.executeJavaScript).mockImplementation((expression: string) => {
      if (isPageCall(expression, 'clickElement')) {
        return Promise.resolve({ dispatched: false, x: 24, y: 48, element: 'Channels' })
      }
      if (isPageCall(expression, 'readActiveElementState')) return Promise.resolve({})
      if (isPageCall(expression, 'readPageActionState')) {
        actionReads++
        return Promise.resolve({
          url: 'https://example.com/login',
          title: 'Example',
          focus: 'body',
          mutationRevision: actionReads === 1 ? 0 : 1,
          dialogs: [],
          scroll: [0],
          targetState: { ariaExpanded: actionReads === 1 ? 'false' : 'true' },
        })
      }
      return Promise.resolve(undefined)
    })

    const result = await driver.executeTool('chat-test', 'browser_click', { elementId: 0 })

    expect(result).toMatchObject({
      ok: true,
      result: { effectObserved: true, effect: { targetChanged: true } },
    })
  })

  it('confirms a panel close when the clicked target semantically disappears', async () => {
    const contents = await openPage()
    let actionReads = 0
    vi.mocked(contents.executeJavaScript).mockImplementation((expression: string) => {
      if (isPageCall(expression, 'clickElement')) {
        return Promise.resolve({ dispatched: false, x: 24, y: 48, element: 'Close thread' })
      }
      if (isPageCall(expression, 'readActiveElementState')) return Promise.resolve({})
      if (isPageCall(expression, 'readPageActionState')) {
        actionReads++
        return Promise.resolve({
          url: 'https://example.com/thread',
          title: 'Thread',
          focus: 'body',
          mutationRevision: actionReads === 1 ? 0 : 2,
          dialogs: [],
          popups: [],
          scroll: [0],
          targetState:
            actionReads === 1
              ? { present: true, rendered: true }
              : { present: false, rendered: false },
        })
      }
      return Promise.resolve(undefined)
    })

    const result = await driver.executeTool('chat-test', 'browser_click', { elementId: 0 })

    expect(result).toMatchObject({
      ok: true,
      result: {
        effectObserved: true,
        possibleEffectObserved: true,
        effect: { targetChanged: true },
      },
    })
    expect(result).not.toMatchObject({
      result: { note: expect.stringContaining('background DOM/title churn') },
    })
  })

  it('reports failed submit dispatch separately from a completed text write', async () => {
    const contents = await openPage()
    respondWith(contents, {
      focusElementForTyping: { focused: true, kind: 'input', x: 24, y: 48 },
      activeElementSecrecy: 'safe',
      readActiveElementState: { activeElement: 'input', valueLength: 5 },
      readPageActionState: {
        url: 'https://example.com/login',
        title: 'Example',
        focus: 'input',
        mutationRevision: 0,
        dialogs: [],
        scroll: [0],
      },
    })
    vi.mocked(contents.debugger.sendCommand).mockImplementation((method, params) => {
      if (
        method === 'Input.dispatchKeyEvent' &&
        (params as { key?: string } | undefined)?.key === 'Enter'
      ) {
        return Promise.reject(new Error('dispatch rejected'))
      }
      return Promise.resolve({})
    })

    const result = await driver.executeTool('chat-test', 'browser_type', {
      elementId: 0,
      text: 'hello',
      submit: true,
    })

    expect(result).toMatchObject({
      ok: true,
      result: {
        dispatched: true,
        submitRequested: true,
        submitted: false,
        submitUncertain: true,
        note: expect.stringContaining('submission is uncertain'),
      },
    })
  })

  it('does not retry text when Chromium loses the insert acknowledgement', async () => {
    const contents = await openPage()
    respondWith(contents, {
      focusElementForTyping: { focused: true, kind: 'input', x: 24, y: 48 },
      activeElementSecrecy: 'safe',
      readActiveElementState: { activeElement: 'input', valueLength: 5 },
    })
    vi.mocked(contents.debugger.sendCommand).mockImplementation((method) => {
      if (method === 'Input.insertText') {
        return Promise.reject(new Error('insert acknowledgement lost'))
      }
      return Promise.resolve({})
    })

    const result = await driver.executeTool('chat-test', 'browser_type', {
      elementId: 0,
      text: 'hello',
    })

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('may have reached the field and was not retried'),
    })
    expect(
      vi
        .mocked(contents.executeJavaScript)
        .mock.calls.some(([expression]) => String(expression).includes('typeIntoElement'))
    ).toBe(false)
  })

  it('does not dispatch a late click after its page probe times out', async () => {
    vi.useFakeTimers()
    try {
      const contents = await openPage()
      let resolveClick: ((value: unknown) => void) | undefined
      respondWith(contents, {
        clickElement: new Promise((resolve) => {
          resolveClick = resolve
        }),
      })

      const result = driver.executeTool('chat-test', 'browser_click', { elementId: 0 })
      await vi.advanceTimersByTimeAsync(20_000)
      await expect(result).resolves.toMatchObject({ ok: false })

      resolveClick?.({ dispatched: false, x: 24, y: 48, element: 'Too late' })
      await Promise.resolve()
      await Promise.resolve()

      expect(cdpCalls(contents, 'Input.dispatchMouseEvent')).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses the isolated top-page target when Electron reports mainFrame as focused', async () => {
    const contents = await openPage()
    const mainFrame = {
      isDestroyed: vi.fn(() => false),
      executeJavaScript: vi.fn(() => Promise.reject(new Error('wrong execution target'))),
    }
    Object.defineProperty(contents, 'mainFrame', { configurable: true, value: mainFrame })
    Object.defineProperty(contents, 'focusedFrame', { configurable: true, value: mainFrame })
    respondWith(contents, {
      activeElementSecrecy: 'safe',
      readActiveElementState: {},
      readPageActionState: {
        url: 'https://example.com/login',
        title: 'Example',
        focus: 'body',
        mutationRevision: 0,
        dialogs: [],
        scroll: [0],
      },
    })

    const result = await driver.executeTool('chat-test', 'browser_press_key', { key: 'Escape' })

    expect(result.ok).toBe(true)
    expect(mainFrame.executeJavaScript).not.toHaveBeenCalled()
  })

  // A dialog that was ALREADY open before the click is not obstructing the
  // navigation it survived — reporting it made every SPA route change under a
  // persistent role=dialog (cookie banner, side drawer, picker) read as a
  // failed click. Only a dialog that arrives with the navigation obstructs it.
  // targetChanged can only fire when pageActionState was given an elementId.
  // Tools without one listed it in their effect formula for a long time, where
  // it was silently always false — coverage that read as real. This pins the
  // dependency so the next tool that adds the term has to earn it.
  it('cannot observe a target change for a tool that passes no elementId', async () => {
    const contents = await openPage()
    let actionReads = 0
    vi.mocked(contents.executeJavaScript).mockImplementation((expression: string) => {
      if (isPageCall(expression, 'readActiveElementState')) return Promise.resolve({})
      if (isPageCall(expression, 'readPageActionState')) {
        actionReads++
        // No targetState in either sample: that is what a call without an
        // elementId returns.
        return Promise.resolve({
          url: 'https://example.com/a',
          title: 'A',
          focus: 'body',
          mutationRevision: actionReads === 1 ? 0 : 3,
          dialogs: [],
          popups: [],
          scroll: [0],
        })
      }
      return Promise.resolve(undefined)
    })

    const result = await driver.executeTool('chat-test', 'browser_press_key', { key: 'Enter' })

    expect(result).toMatchObject({ ok: true })
    const effect = (result as { result?: { effect?: Record<string, boolean> } }).result?.effect
    expect(effect?.targetChanged).toBe(false)
  })

  // The click-that-navigates race from the field: "Begin Assessment" submits a
  // form, the navigation tears the origin document down, and the CDP dispatch
  // rejects mid-press. The press already reached the page — the navigation IS
  // the success — so this must come back dispatched, not failed.
  it('reports a click whose navigation destroyed the page as a success', async () => {
    const contents = await openPage()
    let currentUrl = 'https://example.com/tests/IPIP-BFFM/'
    vi.mocked(contents.getURL).mockImplementation(() => currentUrl)
    vi.mocked(contents.executeJavaScript).mockImplementation((expression: string) => {
      if (isPageCall(expression, 'describePointTarget')) {
        return Promise.resolve({ found: true, element: 'Begin Assessment', cursor: 'pointer' })
      }
      if (isPageCall(expression, 'readActiveElementState')) return Promise.resolve({})
      if (isPageCall(expression, 'readPageActionState')) {
        return Promise.resolve({
          url: currentUrl,
          title: 'Test',
          focus: 'body',
          mutationRevision: 0,
          dialogs: [],
          popups: [],
          scroll: [0],
        })
      }
      return Promise.resolve(undefined)
    })
    vi.mocked(contents.debugger.sendCommand).mockImplementation(async (method: string) => {
      if (method === 'Input.dispatchMouseEvent') {
        currentUrl = 'https://example.com/tests/IPIP-BFFM/1.php'
        throw new Error('Execution context was destroyed, most likely because of a navigation.')
      }
      return {}
    })

    const result = await driver.executeTool('chat-test', 'browser_click_at', { x: 100, y: 200 })

    expect(result).toMatchObject({
      ok: true,
      result: {
        dispatched: true,
        navigatedDuringDispatch: true,
        effectObserved: true,
      },
    })
  })

  it('ignores a dialog that was already open before the click', async () => {
    const contents = await openPage()
    let actionReads = 0
    vi.mocked(contents.executeJavaScript).mockImplementation((expression: string) => {
      if (isPageCall(expression, 'clickElement')) {
        return Promise.resolve({ dispatched: false, x: 24, y: 48, element: 'Search result' })
      }
      if (isPageCall(expression, 'readActiveElementState')) return Promise.resolve({})
      if (isPageCall(expression, 'readPageActionState')) {
        actionReads++
        return Promise.resolve(
          actionReads === 1
            ? {
                url: 'https://example.com/search',
                title: 'Search',
                focus: 'body',
                mutationRevision: 0,
                dialogs: ['Search'],
                scroll: [0],
              }
            : {
                url: 'https://example.com/channel/eng-bugs',
                title: 'eng-bugs',
                focus: 'body',
                mutationRevision: 1,
                dialogs: ['Search'],
                scroll: [0],
              }
        )
      }
      return Promise.resolve(undefined)
    })

    const result = await driver.executeTool('chat-test', 'browser_click', { elementId: 0 })

    expect(result).toMatchObject({
      ok: true,
      result: { effectObserved: true, obstructedAfterNavigation: false, dialogs: ['Search'] },
    })
  })

  it('reports navigation obstructed by a dialog that opened with it', async () => {
    const contents = await openPage()
    let actionReads = 0
    vi.mocked(contents.executeJavaScript).mockImplementation((expression: string) => {
      if (isPageCall(expression, 'clickElement')) {
        return Promise.resolve({ dispatched: false, x: 24, y: 48, element: 'Search result' })
      }
      if (isPageCall(expression, 'readActiveElementState')) return Promise.resolve({})
      if (isPageCall(expression, 'readPageActionState')) {
        actionReads++
        return Promise.resolve(
          actionReads === 1
            ? {
                url: 'https://example.com/search',
                title: 'Search',
                focus: 'body',
                mutationRevision: 0,
                dialogs: [],
                scroll: [0],
              }
            : {
                url: 'https://example.com/channel/eng-bugs',
                title: 'eng-bugs',
                focus: 'body',
                mutationRevision: 1,
                dialogs: ['Open in the Slack app?'],
                scroll: [0],
              }
        )
      }
      return Promise.resolve(undefined)
    })

    const result = await driver.executeTool('chat-test', 'browser_click', { elementId: 0 })

    expect(result).toMatchObject({
      ok: true,
      result: {
        obstructedAfterNavigation: true,
        note: expect.stringContaining('Open in the Slack app?'),
      },
    })
  })

  it('surfaces a CDP dialog notice on the next tool result exactly once', async () => {
    const contents = await openPage()
    const listener = vi
      .mocked(contents.debugger.on)
      .mock.calls.find(([event]) => event === 'message')?.[1] as
      | ((event: unknown, method: string, params: unknown, sessionId?: string) => void)
      | undefined
    expect(listener).toBeTypeOf('function')

    listener?.({}, 'Page.javascriptDialogOpening', { type: 'alert', message: 'Heads up' })
    await vi.waitFor(() =>
      expect(contents.debugger.sendCommand).toHaveBeenCalledWith('Page.handleJavaScriptDialog', {
        accept: false,
      })
    )

    const first = await driver.executeTool('chat-test', 'browser_list_tabs', {})
    const second = await driver.executeTool('chat-test', 'browser_list_tabs', {})

    expect(first).toMatchObject({
      ok: true,
      result: {
        notices: [expect.stringContaining('alert dialog ("Heads up") which was auto-dismissed')],
      },
    })
    expect(second).not.toMatchObject({ result: { notices: expect.anything() } })
  })

  it('invalidates element ids when the active tab changes', async () => {
    await openPage()
    await driver.executeTool('chat-test', 'browser_open_tab', {})

    const result = await driver.executeTool('chat-test', 'browser_click', { elementId: 0 })

    expect(result).toEqual({
      ok: false,
      error:
        'Element ids are not valid in this tab. Call browser_snapshot and use an id from that result.',
    })
  })

  /** Fires every instrumentation listener registered for a WebContents event. */
  function emitContentsEvent(
    contents: Awaited<ReturnType<typeof openPage>>,
    event: string,
    ...args: unknown[]
  ): void {
    for (const [name, listener] of vi.mocked(contents.on).mock.calls) {
      if (name === event) (listener as (...listenerArgs: unknown[]) => void)({}, ...args)
    }
  }

  it('keeps element ids across a same-document (SPA) navigation', async () => {
    const contents = await openPage()
    respondWith(contents, {})

    emitContentsEvent(contents, 'did-navigate-in-page')
    const result = await driver.executeTool('chat-test', 'browser_click', { elementId: 0 })

    expect(result).toMatchObject({ ok: true, result: { dispatched: true } })
  })

  it('still invalidates element ids on a cross-document navigation', async () => {
    const contents = await openPage()
    respondWith(contents, {})

    emitContentsEvent(contents, 'did-navigate')
    const result = await driver.executeTool('chat-test', 'browser_click', { elementId: 0 })

    expect(result).toEqual({
      ok: false,
      error:
        'Element ids are not valid in this tab. Call browser_snapshot and use an id from that result.',
    })
  })

  it('tolerates same-document URL churn during a keypress', async () => {
    const contents = await openPage()
    let urlReads = 0
    vi.mocked(contents.getURL).mockImplementation(() =>
      ++urlReads === 1 ? 'https://example.com/channel-a' : 'https://example.com/channel-b'
    )
    respondWith(contents, {
      activeElementSecrecy: 'safe',
      readActiveElementState: {},
      readPageActionState: {
        url: 'https://example.com/channel-a',
        title: 'Example',
        focus: 'body',
        mutationRevision: 0,
        dialogs: [],
        scroll: [0],
      },
    })

    const result = await driver.executeTool('chat-test', 'browser_press_key', { key: 'Escape' })

    expect(result.ok).toBe(true)
    expect(cdpCalls(contents, 'Input.dispatchKeyEvent').length).toBeGreaterThan(0)
  })

  it('aborts a keypress when a cross-document navigation lands mid-flight', async () => {
    const contents = await openPage()
    let navigated = false
    vi.mocked(contents.executeJavaScript).mockImplementation((expression: string) => {
      if (isPageCall(expression, 'activeElementSecrecy')) return Promise.resolve('safe')
      if (isPageCall(expression, 'readActiveElementState')) return Promise.resolve({})
      if (isPageCall(expression, 'readPageActionState')) {
        if (!navigated) {
          navigated = true
          emitContentsEvent(contents, 'did-navigate')
        }
        return Promise.resolve({
          url: 'https://example.com/login',
          title: 'Example',
          focus: 'body',
          mutationRevision: 0,
          dialogs: [],
          scroll: [0],
        })
      }
      return Promise.resolve(undefined)
    })

    const result = await driver.executeTool('chat-test', 'browser_press_key', { key: 'Escape' })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/active tab or page changed/)
    expect(cdpCalls(contents, 'Input.dispatchKeyEvent')).toHaveLength(0)
  })

  it('waits for a late-mounting editor before typing', async () => {
    const contents = await openPage()
    let focusReads = 0
    vi.mocked(contents.executeJavaScript).mockImplementation((expression: string) => {
      if (isPageCall(expression, 'focusElementForTyping')) {
        focusReads++
        return Promise.resolve(
          focusReads === 1
            ? { error: 'not-editable' }
            : { focused: true, kind: 'contenteditable', x: 24, y: 48 }
        )
      }
      if (isPageCall(expression, 'activeElementSecrecy')) return Promise.resolve('safe')
      if (isPageCall(expression, 'readActiveElementState')) {
        return Promise.resolve({ activeElement: 'div', valueLength: 5 })
      }
      return Promise.resolve(undefined)
    })

    const result = await driver.executeTool('chat-test', 'browser_type', {
      elementId: 0,
      text: 'hello',
    })

    expect(result.ok).toBe(true)
    expect(focusReads).toBeGreaterThan(1)
    expect(cdpCalls(contents, 'Input.insertText')).toHaveLength(1)
  })

  it('reprobes a transiently stale click target before giving up', async () => {
    const contents = await openPage()
    let clickReads = 0
    vi.mocked(contents.executeJavaScript).mockImplementation((expression: string) => {
      if (isPageCall(expression, 'clickElement')) {
        clickReads++
        return Promise.resolve(
          clickReads === 1
            ? { error: 'stale' }
            : { dispatched: false, x: 24, y: 48, element: 'Channel row' }
        )
      }
      if (isPageCall(expression, 'readActiveElementState')) return Promise.resolve({})
      if (isPageCall(expression, 'readPageActionState')) return Promise.resolve({})
      return Promise.resolve(undefined)
    })

    const result = await driver.executeTool('chat-test', 'browser_click', { elementId: 0 })

    expect(result).toMatchObject({ ok: true, result: { dispatched: true } })
    expect(clickReads).toBeGreaterThan(1)
  })

  it('clicks a coordinate point with native input and reports the target', async () => {
    const contents = await openPage()
    respondWith(contents, {
      describePointTarget: {
        found: true,
        element: 'button "Send"',
        editable: false,
        secret: false,
        fileInput: false,
        cursor: 'pointer',
      },
      readActiveElementState: {},
      readPageActionState: {},
    })

    const result = await driver.executeTool('chat-test', 'browser_click_at', { x: 120, y: 240 })

    expect(result).toMatchObject({
      ok: true,
      result: {
        dispatched: true,
        trusted: true,
        clickedAt: { x: 120, y: 240 },
        target: 'button "Send"',
      },
    })
    const presses = cdpCalls(contents, 'Input.dispatchMouseEvent').filter(
      ([, event]) => (event as { type?: string }).type === 'mousePressed'
    )
    expect(presses).toHaveLength(1)
  })

  it('double-clicks a coordinate point as a rising clickCount sequence', async () => {
    const contents = await openPage()
    respondWith(contents, {
      describePointTarget: { found: true, element: 'canvas', editable: false },
      readActiveElementState: {},
      readPageActionState: {},
    })

    const result = await driver.executeTool('chat-test', 'browser_click_at', {
      x: 10,
      y: 20,
      clickCount: 2,
    })

    expect(result).toMatchObject({ ok: true, result: { clickCount: 2 } })
    const counts = cdpCalls(contents, 'Input.dispatchMouseEvent')
      .filter(([, event]) => (event as { type?: string }).type === 'mousePressed')
      .map(([, event]) => (event as { clickCount?: number }).clickCount)
    expect(counts).toEqual([1, 2])
  })

  it('refuses a coordinate click on a file input', async () => {
    const contents = await openPage()
    respondWith(contents, {
      describePointTarget: { found: true, element: 'input', fileInput: true },
    })

    const result = await driver.executeTool('chat-test', 'browser_click_at', { x: 5, y: 5 })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/file input/)
    expect(cdpCalls(contents, 'Input.dispatchMouseEvent')).toHaveLength(0)
  })

  it('rejects a coordinate click outside the viewport with mapping guidance', async () => {
    const contents = await openPage()
    respondWith(contents, {
      describePointTarget: { error: 'outside-viewport' },
    })

    const result = await driver.executeTool('chat-test', 'browser_click_at', { x: 9999, y: 5 })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/divide image pixels by its scale/)
  })

  it('inserts text into the focused editable at the caret', async () => {
    const contents = await openPage()
    respondWith(contents, {
      activeElementSecrecy: 'safe',
      describeFocusedEditable: { editable: true, kind: 'contenteditable' },
      readActiveElementState: { activeElement: 'div', valueLength: 12 },
      readPageActionState: {},
    })

    const result = await driver.executeTool('chat-test', 'browser_insert_text', {
      text: 'hello world',
    })

    expect(result).toMatchObject({
      ok: true,
      result: { dispatched: true, trusted: true, kind: 'contenteditable', insertedChars: 11 },
    })
    expect(cdpCalls(contents, 'Input.insertText')).toHaveLength(1)
  })

  it('refuses insertion when nothing editable holds focus', async () => {
    const contents = await openPage()
    respondWith(contents, {
      activeElementSecrecy: 'safe',
      describeFocusedEditable: { editable: false, reason: 'none' },
    })

    const result = await driver.executeTool('chat-test', 'browser_insert_text', { text: 'x' })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/No element is focused/)
    expect(cdpCalls(contents, 'Input.insertText')).toHaveLength(0)
  })

  it('refuses insertion while a password field holds focus', async () => {
    const contents = await openPage()
    respondWith(contents, { activeElementSecrecy: 'secret' })

    const result = await driver.executeTool('chat-test', 'browser_insert_text', { text: 'x' })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Refusing to act on a password field/)
    expect(cdpCalls(contents, 'Input.insertText')).toHaveLength(0)
  })

  it('drags between coordinate points through the trusted pointer pipeline', async () => {
    const contents = await openPage()
    respondWith(contents, {
      describePointTarget: { found: true, element: 'div "Card"' },
      readActiveElementState: {},
      readPageActionState: {},
    })

    const result = await driver.executeTool('chat-test', 'browser_drag', {
      fromX: 40,
      fromY: 50,
      toX: 200,
      toY: 260,
    })

    expect(result).toMatchObject({
      ok: true,
      result: { dispatched: true, trusted: true, from: { x: 40, y: 50 }, to: { x: 200, y: 260 } },
    })
    const events = cdpCalls(contents, 'Input.dispatchMouseEvent').map(
      ([, event]) => (event as { type?: string }).type
    )
    expect(events[0]).toBe('mouseMoved')
    expect(events).toContain('mousePressed')
    expect(events[events.length - 1]).toBe('mouseReleased')
    expect(cdpCalls(contents, 'Input.setInterceptDrags').length).toBeGreaterThan(0)
  })

  it('drags from a snapshot element to a coordinate target', async () => {
    const contents = await openPage()
    respondWith(contents, {
      clickElement: { dispatched: false, x: 24, y: 48, element: 'Card "Ship it"' },
      describePointTarget: { found: true, element: 'section "Done"' },
      readActiveElementState: {},
      readPageActionState: {},
    })

    const result = await driver.executeTool('chat-test', 'browser_drag', {
      fromElementId: 0,
      toX: 300,
      toY: 60,
    })

    expect(result).toMatchObject({
      ok: true,
      result: { dispatched: true, from: { x: 24, y: 48, element: 'Card "Ship it"' } },
    })
  })

  it('rejects a drag whose endpoints are the same point', async () => {
    const contents = await openPage()
    respondWith(contents, {
      describePointTarget: { found: true, element: 'div' },
    })

    const result = await driver.executeTool('chat-test', 'browser_drag', {
      fromX: 10,
      fromY: 10,
      toX: 10,
      toY: 10,
    })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/same point/)
  })

  it('returns the screenshot scale for coordinate mapping', async () => {
    const contents = await openPage()
    vi.mocked(contents.debugger.sendCommand).mockImplementation((method: string) => {
      if (method === 'Page.getLayoutMetrics') {
        return Promise.resolve({
          cssLayoutViewport: { clientWidth: 2048, clientHeight: 1024 },
        })
      }
      if (method === 'Page.captureScreenshot') {
        return Promise.resolve({ data: 'c2lt' })
      }
      return Promise.resolve(undefined)
    })
    respondWith(contents, { getViewportInfo: { width: 2048, height: 1024 } })

    const result = await driver.executeTool('chat-test', 'browser_screenshot', {})

    expect(result).toMatchObject({ ok: true, result: { scale: 0.5 } })
  })
})
