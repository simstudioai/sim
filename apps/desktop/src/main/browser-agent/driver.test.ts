import { BROWSER_TOOL_QUEUE_WAIT_TIMEOUT_MS } from '@sim/browser-protocol'
import { toRecord } from '@sim/utils/object'
import type { WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

const { stageUploadFiles, saveDownloadToWorkspace } = vi.hoisted(() => ({
  stageUploadFiles: vi.fn(),
  saveDownloadToWorkspace: vi.fn(),
}))
vi.mock('@/main/browser-agent/file-transfer', () => ({
  stageUploadFiles,
  saveDownloadToWorkspace,
  discardStagedUploads: vi.fn(async () => {}),
}))

import { BrowserWindow, type nativeImage } from 'electron'
import * as cdp from '@/main/browser-agent/cdp'
import * as driverModule from '@/main/browser-agent/driver'
import * as session from '@/main/browser-agent/session'
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

type BrowserToolQueueBoundary = NonNullable<
  ReturnType<DriverModule['captureBrowserToolQueueBoundary']>
>

function capturePendingAuthorizations(
  driver: DriverModule,
  scopeId: string,
  count: number = driver.BROWSER_TOOL_ADMISSION_LIMITS.perScope
): BrowserToolQueueBoundary[] {
  const boundaries = Array.from({ length: count }, () =>
    driver.captureBrowserToolQueueBoundary(scopeId)
  )
  expect(boundaries.every((boundary) => boundary !== null)).toBe(true)
  return boundaries.filter((boundary): boundary is BrowserToolQueueBoundary => boundary !== null)
}

function releasePendingAuthorizations(
  driver: DriverModule,
  boundaries: readonly BrowserToolQueueBoundary[]
): void {
  for (const boundary of boundaries) driver.releaseBrowserToolQueueBoundary(boundary)
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
    const prepare = vi.spyOn(session, 'prepareExplicitNavigation')
    const result = await driver.executeTool('chat-test', 'browser_navigate', {
      url: 'file:///etc/passwd',
    })
    expect(result).toEqual({
      ok: false,
      error: 'URL must be absolute and start with http:// or https://',
    })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('still waits for a replacement load after loadURL has resolved', async () => {
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    const contents = session.requireTab().view.webContents
    vi.mocked(contents.isLoading).mockReturnValue(true)
    vi.useFakeTimers()
    try {
      let settled = false
      const navigation = driver.executeTool('chat-test', 'browser_navigate', {
        url: 'http://127.0.0.1/loading',
      })
      void navigation.then(() => {
        settled = true
      })

      await vi.advanceTimersByTimeAsync(500)
      expect(settled).toBe(false)
      vi.mocked(contents.isLoading).mockReturnValue(false)
      for (const [event, listener] of vi.mocked(contents.on).mock.calls) {
        if (String(event) === 'did-stop-loading') {
          const onLoadComplete = listener as (...args: unknown[]) => void
          onLoadComplete()
        }
      }
      await vi.advanceTimersByTimeAsync(399)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(settled).toBe(true)
      await expect(navigation).resolves.toMatchObject({ ok: true })
    } finally {
      vi.useRealTimers()
    }
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

  it('uses the shared failed-page recovery path when reloading', async () => {
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    const tab = session.requireTab()
    tab.pageIssue = {
      kind: 'load-error',
      url: 'https://example.com/failed',
      code: -102,
      description: 'ERR_CONNECTION_REFUSED',
    }
    vi.mocked(tab.view.webContents.loadURL).mockImplementationOnce(async () => {
      session.notePageLoadStarted(tab.view.webContents)
    })
    vi.useFakeTimers()
    try {
      const result = driver.executeTool('chat-test', 'browser_reload', {})
      await vi.advanceTimersByTimeAsync(500)

      await expect(result).resolves.toMatchObject({ ok: true })
      expect(tab.view.webContents.loadURL).toHaveBeenCalledWith('https://example.com/failed')
      expect(tab.view.webContents.reload).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
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

  it('does not let a detached screenshot verification touch a disposed scope', async () => {
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    const contents = session.requireTab().view.webContents
    vi.mocked(contents.getURL).mockReturnValue('https://example.com/')
    let resolveCapture: (capture: cdp.ScreenshotCapture) => void = () => {}
    const captureScreenshot = vi.spyOn(cdp, 'captureScreenshot').mockImplementation(
      () =>
        new Promise<cdp.ScreenshotCapture>((resolve) => {
          resolveCapture = resolve
        })
    )
    const automationTab = vi.spyOn(session, 'automationTab')
    try {
      const screenshot = driver.executeTool(
        'chat-test',
        'browser_screenshot',
        {},
        'tool-disposed-screenshot'
      )
      await Promise.resolve()
      expect(captureScreenshot).toHaveBeenCalledOnce()
      const signal = captureScreenshot.mock.calls[0][2]
      expect(signal?.aborted).toBe(false)

      driver.disposeBrowserScope('chat-test')
      expect(signal?.aborted).toBe(true)
      automationTab.mockClear()
      await expect(screenshot).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('cancelled'),
      })
      resolveCapture({
        dataUrl: 'data:image/jpeg;base64,c2lt',
        scale: 1,
        viewport: { width: 800, height: 600 },
        imageSize: { width: 800, height: 600 },
      })
      await Promise.resolve()
      await Promise.resolve()

      expect(automationTab).not.toHaveBeenCalled()
    } finally {
      automationTab.mockRestore()
      captureScreenshot.mockRestore()
    }
  })

  it('cancels active and queued work before closing the browser session', async () => {
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    vi.useFakeTimers()
    try {
      const waiting = driver.executeTool(
        'chat-test',
        'browser_wait_for',
        { timeoutMs: 120_000 },
        'tool-active-at-close'
      )
      await vi.advanceTimersByTimeAsync(0)
      const queuedOpen = driver.executeTool(
        'chat-test',
        'browser_open_tab',
        {},
        'tool-queued-at-close'
      )

      driver.closeBrowserSession()

      await expect(waiting).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('cancelled'),
      })
      await expect(queuedOpen).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('cancelled before it started'),
      })
      expect(session.withBrowserScope('chat-test', () => session.peekTabsState()).tabs).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects authorization captured before a browser-session teardown', async () => {
    const boundary = driver.captureBrowserToolQueueBoundary('chat-test')
    expect(boundary).not.toBeNull()
    if (!boundary) throw new Error('Expected browser tool authorization admission')
    driver.closeBrowserSession()
    driver.activateBrowserScope('chat-test')

    await expect(
      driver.executeTool(
        'chat-test',
        'browser_open_tab',
        {},
        'tool-authorized-before-close',
        boundary
      )
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('cancelled before it started'),
    })
    expect(session.withBrowserScope('chat-test', () => session.peekTabsState()).tabs).toEqual([])
  })

  it('rejects a first-use authorization after its scope is disposed and reopened', async () => {
    const boundary = driver.captureBrowserToolQueueBoundary('chat-first-use-disposed')
    expect(boundary).not.toBeNull()
    if (!boundary) throw new Error('Expected browser tool authorization admission')

    driver.disposeBrowserScope('chat-first-use-disposed')
    driver.activateBrowserScope('chat-first-use-disposed')

    await expect(
      driver.executeTool(
        'chat-first-use-disposed',
        'browser_open_tab',
        {},
        'tool-authorized-before-first-use-disposal',
        boundary
      )
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('cancelled before it started'),
    })
    expect(
      session.withBrowserScope('chat-first-use-disposed', () => session.peekTabsState()).tabs
    ).toEqual([])
  })

  it('cancels a provisional first-use authorization when its durable scope is disposed', async () => {
    const boundary = driver.captureBrowserToolQueueBoundary('pending:first-use-disposed')
    expect(boundary).not.toBeNull()
    if (!boundary) throw new Error('Expected browser tool authorization admission')
    expect(driver.migrateBrowserScope('pending:first-use-disposed', 'chat-first-use-durable')).toBe(
      true
    )

    driver.disposeBrowserScope('chat-first-use-durable')
    driver.activateBrowserScope('chat-first-use-durable')

    await expect(
      driver.executeTool(
        'chat-first-use-durable',
        'browser_open_tab',
        {},
        'tool-authorized-before-migrated-disposal',
        boundary
      )
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('cancelled before it started'),
    })
  })

  it('keeps authorization teardown scoped to its existing driver state', async () => {
    driver.activateBrowserScope('chat-other')
    const boundary = driver.captureBrowserToolQueueBoundary('chat-other')
    expect(boundary).not.toBeNull()
    if (!boundary) throw new Error('Expected browser tool authorization admission')

    driver.disposeBrowserScope('chat-test')

    await expect(
      driver.executeTool(
        'chat-other',
        'browser_list_tabs',
        {},
        'tool-authorized-in-other-scope',
        boundary
      )
    ).resolves.toMatchObject({ ok: true })
  })

  it('bounds pending authorizations without materializing their scopes', () => {
    const boundaries = capturePendingAuthorizations(driver, 'chat-pending-authorization')

    expect(boundaries.every((boundary) => boundary?.generation === null)).toBe(true)
    expect(driver.captureBrowserToolQueueBoundary('chat-pending-authorization')).toBeNull()

    releasePendingAuthorizations(driver, boundaries)
    const replacement = driver.captureBrowserToolQueueBoundary('chat-pending-authorization')
    expect(replacement).not.toBeNull()
    if (replacement) driver.releaseBrowserToolQueueBoundary(replacement)
  })

  it('retains cancelled authorization admissions until their fetches settle', () => {
    const boundaries = capturePendingAuthorizations(driver, 'chat-test')

    expect(driver.cancelActiveTool('chat-test')).toBe(true)
    expect(boundaries.every((boundary) => boundary.cancelled)).toBe(true)
    expect(driver.captureBrowserToolQueueBoundary('chat-test')).toBeNull()

    releasePendingAuthorizations(driver, boundaries)
    const replacement = driver.captureBrowserToolQueueBoundary('chat-test')
    expect(replacement).not.toBeNull()
    if (replacement) driver.releaseBrowserToolQueueBoundary(replacement)
  })

  it('retains process-wide authorization admissions across driver reinitialization', () => {
    const boundaries = ['chat-auth-a', 'chat-auth-b', 'chat-auth-c', 'chat-auth-d'].flatMap(
      (scopeId) => capturePendingAuthorizations(driver, scopeId)
    )
    expect(boundaries).toHaveLength(driver.BROWSER_TOOL_ADMISSION_LIMITS.process)

    driver.initDriver(
      {
        onPageState: vi.fn(),
        onTabsState: vi.fn(),
        onSessionStatus: vi.fn(),
        onFillAvailability: vi.fn(),
      },
      () => null
    )

    expect(boundaries.every((boundary) => boundary.cancelled)).toBe(true)
    expect(driver.captureBrowserToolQueueBoundary('chat-after-reinit')).toBeNull()

    driver.releaseBrowserToolQueueBoundary(boundaries[0])
    const replacement = driver.captureBrowserToolQueueBoundary('chat-after-reinit')
    expect(replacement).not.toBeNull()
    if (replacement) driver.releaseBrowserToolQueueBoundary(replacement)
    releasePendingAuthorizations(driver, boundaries.slice(1))
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
    }) => { action: string; createWindow?: (options: object) => unknown }

    const decision = openWindow({ url: 'https://user-popup.example/' })
    expect(decision.action).toBe('allow')
    decision.createWindow?.({})
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
    }) => { action: string; createWindow?: (options: object) => unknown }

    const decision = openWindow({ url: 'https://agent-popup.example/' })
    expect(decision.action).toBe('allow')
    decision.createWindow?.({})
    const popup = session.requireAutomationTab().view.webContents
    expect(session.activeTab()?.view.webContents).toBe(source)
    session.setAutomationActive(false)
    expect(session.automationTab()?.view.webContents).toBe(popup)
    expect(popup.loadURL).toHaveBeenCalledWith('https://agent-popup.example/')
  })

  it('does not report a timed-out restored tab as ready to the model', async () => {
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    const tab = session.requireTab()
    const wait = vi.spyOn(session, 'waitForPendingTabRestore').mockResolvedValue(false)

    await expect(
      driver.executeTool('chat-test', 'browser_switch_tab', { tabId: tab.id })
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('did not finish loading'),
    })

    wait.mockRestore()
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

  it('cancels only the replaced destination authorizations during migration', async () => {
    await driver.executeTool('pending:new-chat', 'browser_open_tab', {})
    driver.activateBrowserScope('chat-real')
    const sourceBoundary = driver.captureBrowserToolQueueBoundary('pending:new-chat')
    const destinationBoundary = driver.captureBrowserToolQueueBoundary('chat-real')
    const otherBoundary = driver.captureBrowserToolQueueBoundary('chat-other')
    expect(sourceBoundary).not.toBeNull()
    expect(destinationBoundary).not.toBeNull()
    expect(otherBoundary).not.toBeNull()
    if (!sourceBoundary || !destinationBoundary || !otherBoundary) {
      throw new Error('Expected browser tool authorization admissions')
    }

    expect(driver.migrateBrowserScope('pending:new-chat', 'chat-real')).toBe(true)

    await expect(
      driver.executeTool(
        'chat-real',
        'browser_list_tabs',
        {},
        'tool-destination-before-migration',
        destinationBoundary
      )
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('cancelled before it started'),
    })
    await expect(
      driver.executeTool(
        'chat-real',
        'browser_list_tabs',
        {},
        'tool-source-before-migration',
        sourceBoundary
      )
    ).resolves.toMatchObject({ ok: true })
    await expect(
      driver.executeTool(
        'chat-other',
        'browser_list_tabs',
        {},
        'tool-other-during-migration',
        otherBoundary
      )
    ).resolves.toMatchObject({ ok: true })
  })

  it('retains a migrated provisional alias for callbacks until durable disposal', async () => {
    await driver.executeTool('pending:new-chat', 'browser_open_tab', {})
    const tab = session.withBrowserScope('pending:new-chat', () => session.requireTab())
    expect(driver.migrateBrowserScope('pending:new-chat', 'chat-real')).toBe(true)

    driver.disposeBrowserScope('pending:new-chat')

    await expect(
      driver.executeTool('pending:new-chat', 'browser_list_tabs', {})
    ).resolves.toMatchObject({
      ok: true,
      result: { scopeId: 'chat-real', tabs: [{ tabId: tab.id }] },
    })
    driver.disposeBrowserScope('chat-real')
    expect(tab.view.webContents.close).toHaveBeenCalledOnce()
  })

  it('keeps activation lazy, then restores and disposes through the driver API', async () => {
    const snapshot: BrowserSessionSnapshot = {
      v: 1,
      tabs: [{ url: 'https://restored.example/' }],
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

  it('expires a bounded queue wait without running the stale action later', async () => {
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    const contents = session.requireTab().view.webContents
    vi.mocked(contents.loadURL).mockClear()
    vi.useFakeTimers()
    try {
      const waiting = driver.executeTool(
        'chat-test',
        'browser_wait_for',
        { timeoutMs: 120_000 },
        'tool-queue-head'
      )
      await vi.advanceTimersByTimeAsync(0)
      const queued = driver.executeTool(
        'chat-test',
        'browser_navigate',
        { url: 'http://127.0.0.1/expired' },
        'tool-queue-expired'
      )

      await vi.advanceTimersByTimeAsync(BROWSER_TOOL_QUEUE_WAIT_TIMEOUT_MS)
      await expect(queued).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('waited too long for earlier browser work'),
      })

      expect(driver.cancelTool('chat-test', 'tool-queue-head')).toBe(true)
      await vi.advanceTimersByTimeAsync(0)
      await expect(waiting).resolves.toMatchObject({ ok: false })
      expect(contents.loadURL).not.toHaveBeenCalledWith('http://127.0.0.1/expired')
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds one scope queue and admits new work after the held head is cancelled', async () => {
    vi.useFakeTimers()
    try {
      await driver.executeTool('chat-test', 'browser_open_tab', {})
      const contents = session.requireTab().view.webContents
      vi.mocked(contents.getURL).mockReturnValue('https://example.com/')
      vi.mocked(contents.executeJavaScript).mockImplementation(() => new Promise<never>(() => {}))

      const held = driver.executeTool('chat-test', 'browser_snapshot', {}, 'held-scope-head')
      await vi.advanceTimersByTimeAsync(0)
      const queued = Array.from(
        { length: driver.BROWSER_TOOL_ADMISSION_LIMITS.perScope - 1 },
        (_, index) =>
          driver.executeTool('chat-test', 'browser_list_tabs', {}, `queued-scope-${index}`)
      )

      await expect(
        driver.executeTool('chat-test', 'browser_list_tabs', {}, 'scope-overflow')
      ).resolves.toEqual({
        ok: false,
        error:
          'This task browser already has too many actions queued. Wait for earlier actions to finish.',
      })

      expect(driver.cancelTool('chat-test', 'held-scope-head')).toBe(true)
      await expect(held).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('cancelled'),
      })
      await expect(Promise.all(queued)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ok: true,
            result: expect.objectContaining({ tabs: expect.any(Array) }),
          }),
        ])
      )
      await expect(
        driver.executeTool('chat-test', 'browser_list_tabs', {}, 'scope-recovered')
      ).resolves.toMatchObject({ ok: true })
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

  it.each(['browser_snapshot', 'browser_find'] as const)(
    'does not let a timed-out %s restore refs',
    async (tool) => {
      vi.useFakeTimers()
      try {
        await driver.executeTool('chat-test', 'browser_open_tab', {})
        const contents = session.requireTab().view.webContents
        vi.mocked(contents.getURL).mockReturnValue('https://example.com/')
        let resolveLate: ((value: unknown) => void) | undefined
        vi.mocked(contents.executeJavaScript).mockImplementation((expression: string) => {
          if (!isPageCall(expression, 'collectSnapshot')) return Promise.resolve(undefined)
          return new Promise((resolve) => {
            resolveLate = resolve
          })
        })

        const late = driver.executeTool('chat-test', tool, { query: 'Late' })
        await vi.advanceTimersByTimeAsync(20_000)
        await expect(late).resolves.toMatchObject({ ok: false })
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
          error: expect.stringContaining('Call browser_snapshot'),
        })
      } finally {
        vi.useRealTimers()
      }
    }
  )

  const frameUrls = ['https://ogs.google.com/u/0/widget/app', 'about:srcdoc', 'about:blank']
  it.each(frameUrls)('inspects and interacts with isolated frame %s', async (frameUrl) => {
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
      origin: frameUrl.startsWith('about:') ? 'null' : 'https://ogs.google.com',
      url: frameUrl,
      parent: mainFrame,
      executeJavaScript: vi.fn((expression: string) => {
        if (isPageCall(expression, 'collectSnapshot')) {
          return Promise.resolve({
            url: 'https://ogs.google.com/u/0/widget/app',
            title: 'Google apps [ref=0]',
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
        if ((frame as unknown) === mainFrame) {
          return isPageCall(expression, 'readChildFrameElementState')
            ? mainFrame.executeJavaScript(expression)
            : contents.executeJavaScript(expression)
        }
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
        outline: expect.stringContaining('cross-origin iframe "Google apps [ref\u200b=0]"'),
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

describe('browserToolWatchdogMs', () => {
  it('budgets restored-tab switching as navigation work', () => {
    expect(driverModule.browserToolWatchdogMs('browser_switch_tab', {})).toBe(60_000)
  })

  it.each([
    ['number', 30_000, 35_000],
    ['numeric string', '30000', 35_000],
    ['absent', undefined, 15_000],
    ['non-numeric', 'soon', 15_000],
    ['zero', 0, 15_000],
    ['negative', -5_000, 15_000],
    ['above the wait clamp', 500_000, 125_000],
  ])('normalizes browser_wait_for timeout (%s)', (_label, timeoutMs, expected) => {
    const params = timeoutMs === undefined ? {} : { timeoutMs }

    expect(driverModule.browserToolWatchdogMs('browser_wait_for', params)).toBe(expected)
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
      if (isPageCall(expression, 'clickElement')) return Promise.resolve(CLICK_TARGET)
      return Promise.resolve(undefined)
    })
  }

  function mousePresses(contents: Awaited<ReturnType<typeof openPage>>): number {
    return cdpCalls(contents, 'Input.dispatchMouseEvent').filter(
      ([, params]) => toRecord(params).type === 'mousePressed'
    ).length
  }

  /** What the page reports for an ordinary click target before native dispatch. */
  const CLICK_TARGET = { dispatched: false, x: 24, y: 48, element: 'Test' }

  function cdpCalls(contents: Awaited<ReturnType<typeof openPage>>, method: string): unknown[][] {
    return vi
      .mocked(contents.debugger.sendCommand)
      .mock.calls.filter(([called]) => called === method)
  }

  async function openForm(
    options: {
      refuseAt?: number
      retainValue?: boolean
      afterWrite?: (index: number) => void
      waitForWrite?: Promise<void>
    } = {}
  ) {
    const contents = await openPage()
    const values = ['', '']
    const writes: number[] = []
    const dialogs: string[] = []
    let selectionReads = 0
    vi.mocked(contents.executeJavaScript).mockImplementation(async (expression: string) => {
      const encoded = expression.match(/\.apply\(null, (\[[^\n]*\])\)/)?.[1]
      const args: unknown[] = encoded ? JSON.parse(encoded) : []
      const index = Number(args[0]) - 1
      if (isPageCall(expression, 'collectSnapshot'))
        return {
          url: 'https://example.com/login',
          title: 'Form',
          outline: '- combobox "First" [ref=1]\n- combobox "Second" [ref=2]',
          truncated: false,
          refIds: [1, 2],
          refLineIndexes: { 1: 0, 2: 1 },
          nextElementId: 3,
        }
      if (isPageCall(expression, 'readPageActionState'))
        return {
          url: contents.getURL(),
          dialogs: [...dialogs],
          popups: [],
          observationTruncated: false,
        }
      if (isPageCall(expression, 'readFormFieldState')) {
        if (index === options.refuseAt) return { error: 'password' }
        return {
          matchesRequested: values[index] === args[2],
          valueLength: values[index].length,
          valuePreview: values[index],
          redacted: false,
        }
      }
      if (isPageCall(expression, 'clickElement'))
        return { dispatched: false, x: 24, y: 48, element: 'Select' }
      if (isPageCall(expression, 'selectOptionInElement')) {
        writes.push(index)
        await options.waitForWrite
        const requested = String(args[1])
        if (options.retainValue !== false) values[index] = requested
        options.afterWrite?.(index)
        return { selected: requested, value: requested }
      }
      if (isPageCall(expression, 'readSelectElementState')) {
        selectionReads++
        return { selected: values[index], value: values[index] }
      }
      return undefined
    })
    const snapshot = await driver.executeTool('chat-test', 'browser_snapshot', {})
    expect(snapshot, JSON.stringify(snapshot)).toMatchObject({ ok: true })
    return { contents, values, writes, dialogs, selectionReads: () => selectionReads }
  }

  it.each([
    { values: ['a', 'b'], labels: ['A', 'B'], expected: true },
    { values: ['a'], labels: ['A'], expected: false },
    { values: ['a', 'b'], labels: ['A', 'Other'], expected: false },
  ])(
    'verifies the entire multiple selection %j',
    async ({ values: readbackValues, labels, expected }) => {
      const contents = await openPage()
      respondWith(contents, {
        selectOptionInElement: {
          selected: 'A',
          value: 'a',
          values: ['a', 'b'],
          labels: ['A', 'B'],
        },
        readSelectElementState: { selected: 'A', value: 'a', values: readbackValues, labels },
      })
      const result = await driver.executeTool('chat-test', 'browser_select_option', {
        elementId: 0,
        values: ['a', 'b'],
      })
      expect(result, JSON.stringify(result)).toMatchObject({
        ok: true,
        result: { effectObserved: expected, readback: { values: readbackValues } },
      })
    }
  )

  const formFields = [
    { elementId: 1, kind: 'select', value: 'first' },
    { elementId: 2, kind: 'select', value: 'second' },
  ]

  it('fills known form fields in order and verifies every final value', async () => {
    const form = await openForm()
    const result = await driver.executeTool('chat-test', 'browser_fill_form', {
      fields: formFields,
    })
    expect(result.result, JSON.stringify(result)).toMatchObject({ completed: true })
    expect(form.writes).toEqual([0, 1])
    expect(result).toMatchObject({
      ok: true,
      result: {
        completed: true,
        completedCount: 2,
        results: [
          { index: 0, verified: true, valuePreview: 'first' },
          { index: 1, verified: true, valuePreview: 'second' },
        ],
      },
    })
  })

  it('preflights later secret fields before changing earlier fields', async () => {
    const form = await openForm({ refuseAt: 1 })
    const result = await driver.executeTool('chat-test', 'browser_fill_form', {
      fields: formFields,
    })
    expect(form.writes).toEqual([])
    expect(result).toMatchObject({
      ok: true,
      result: { completed: false, completedCount: 0, stoppedIndex: 1 },
    })
  })

  it('does not mistake dispatch or weak effects for a retained requested value', async () => {
    const form = await openForm({ retainValue: false })
    const result = await driver.executeTool('chat-test', 'browser_fill_form', {
      fields: formFields,
    })
    expect(form.writes).toEqual([0])
    expect(result).toMatchObject({
      ok: true,
      result: {
        completed: false,
        completedCount: 0,
        stoppedIndex: 0,
        results: [{ verified: false }],
        doNotRetry: true,
      },
    })
  })

  it('returns verified partial results and skips later fields when a dialog opens', async () => {
    const form: Awaited<ReturnType<typeof openForm>> = await openForm({
      afterWrite: () => form.dialogs.push('Confirm'),
    })
    const result = await driver.executeTool('chat-test', 'browser_fill_form', {
      fields: formFields,
    })
    expect(form.writes).toEqual([0])
    expect(result).toMatchObject({
      ok: true,
      result: {
        completed: false,
        completedCount: 1,
        results: [{ verified: true }],
        doNotRetry: true,
      },
    })
  })

  it('detects a later field changing an earlier completed field', async () => {
    const form: Awaited<ReturnType<typeof openForm>> = await openForm({
      afterWrite: (index) => {
        if (index === 1) form.values[0] = 'changed'
      },
    })
    const result = await driver.executeTool('chat-test', 'browser_fill_form', {
      fields: formFields,
    })
    expect(result).toMatchObject({
      ok: true,
      result: {
        completed: false,
        stoppedIndex: 0,
        results: [{ verified: false }, { verified: true }],
      },
    })
  })

  it('prevents later form writes after cancellation even if the pending page call resolves late', async () => {
    let releaseWrite: () => void = () => {}
    const waitForWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    const form = await openForm({ waitForWrite })
    const pending = driver.executeTool(
      'chat-test',
      'browser_fill_form',
      { fields: formFields },
      'cancel-form'
    )
    await vi.waitFor(() => expect(form.writes).toEqual([0]))
    driver.cancelTool('chat-test', 'cancel-form')
    expect(await pending).toMatchObject({ ok: false, error: expect.stringContaining('cancelled') })
    releaseWrite()
    await vi.waitFor(() => expect(form.selectionReads()).toBe(1))
    expect(form.writes).toEqual([0])
  })

  function mockScreenshotImage(
    contents: WebContents,
    size: { width: number; height: number } | null
  ): void {
    vi.mocked(contents.capturePage).mockResolvedValue({
      isEmpty: vi.fn(() => size === null),
      getSize: vi.fn(() => size ?? { width: 0, height: 0 }),
      resize: vi.fn(() => ({ toJPEG: vi.fn(() => Buffer.from('resized')) })),
      toJPEG: vi.fn(() => Buffer.alloc(0)),
    } as unknown as ReturnType<typeof nativeImage.createFromBuffer>)
  }

  it('refuses a keystroke while a password field holds focus', async () => {
    const contents = await openPage()
    respondWith(contents, { activeElementSecrecy: 'secret' })

    const result = await driver.executeTool('chat-test', 'browser_press_key', { key: 'a' })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Refusing to act on a password field/)
    expect(result.error).toMatch(/visible browser/)
    expect(result.error).not.toContain('browser_request_takeover')
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

  it('stops repeating once focus reaches a password field', async () => {
    const contents = await openPage()
    let secrecyChecks = 0
    vi.mocked(contents.executeJavaScript).mockImplementation(async (expression: string) => {
      if (isPageCall(expression, 'activeElementSecrecy'))
        return ++secrecyChecks > 1 ? 'secret' : 'safe'
      if (isPageCall(expression, 'readActiveElementState')) return {}
      return undefined
    })

    const result = await driver.executeTool('chat-test', 'browser_press_key', {
      key: 'Tab',
      repeat: 5,
    })

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('1 of 5 times') })
    const downs = cdpCalls(contents, 'Input.dispatchKeyEvent').filter(
      ([, event]) => (event as { type?: string }).type === 'rawKeyDown'
    )
    expect(downs).toHaveLength(1)
  })

  it.each(['cancelled', 'timed out'] as const)(
    'retains a completed action when its observation is %s',
    async (stop) => {
      const contents = await openPage()
      respondWith(contents, {
        activeElementSecrecy: 'safe',
        readActiveElementState: {},
        readPageActionState: {},
      })
      const pageCall = vi.mocked(contents.executeJavaScript).getMockImplementation()
      let releaseObservation: (value: unknown) => void = () => {}
      const observation = new Promise<unknown>((resolve) => {
        releaseObservation = resolve
      })
      let observing = false
      vi.mocked(contents.executeJavaScript).mockImplementation((expression, ...args) => {
        if (isPageCall(expression, 'collectSnapshot')) {
          observing = true
          return observation
        }
        return pageCall?.(expression, ...args) ?? Promise.resolve(undefined)
      })
      vi.useFakeTimers()
      try {
        const timersBefore = vi.getTimerCount()
        const pending = driver.executeTool(
          'chat-test',
          'browser_press_key',
          { key: 'a', observe: {} },
          'observed-action'
        )
        await vi.advanceTimersByTimeAsync(200)
        expect(observing).toBe(true)

        if (stop === 'cancelled') driver.cancelTool('chat-test', 'observed-action')
        else
          await vi.advanceTimersByTimeAsync(driver.browserToolWatchdogMs('browser_press_key', {})!)

        await expect(pending).resolves.toMatchObject({
          ok: true,
          result: {
            pressed: 'a',
            trusted: true,
            observation: {
              ok: false,
              doNotRetry: true,
              note: expect.stringContaining('The action was dispatched'),
            },
          },
        })
        await expect(
          driver.executeTool('chat-test', 'browser_list_tabs', {})
        ).resolves.toMatchObject({
          ok: true,
        })
        expect(vi.getTimerCount()).toBe(timersBefore)
        expect(
          cdpCalls(contents, 'Input.dispatchKeyEvent').filter(([, event]) =>
            ['keyDown', 'rawKeyDown'].includes((event as { type: string }).type)
          )
        ).toHaveLength(1)
      } finally {
        releaseObservation({ outline: 'Late snapshot', refIds: [], nextElementId: 1 })
        await vi.advanceTimersByTimeAsync(0)
        vi.useRealTimers()
      }
    }
  )

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

  it('sets structured input values without dispatching text or select-all keystrokes', async () => {
    const contents = await openPage()
    respondWith(contents, {
      focusElementForTyping: { focused: true, kind: 'input', valueInput: true, x: 24, y: 48 },
      setFocusedInputValue: { dispatched: true },
      readActiveElementState: { activeElement: 'input', valueLength: 10 },
      readPageActionState: {},
    })
    const result = await driver.executeTool('chat-test', 'browser_type', {
      elementId: 0,
      text: '2026-09-15',
    })
    expect(result).toMatchObject({ ok: true, result: { dispatched: true, trusted: false } })
    expect(cdpCalls(contents, 'Input.insertText')).toHaveLength(0)
    expect(cdpCalls(contents, 'Input.dispatchKeyEvent')).toHaveLength(0)
  })

  it('does not retry a rejected structured value through synthetic typing', async () => {
    const contents = await openPage()
    respondWith(contents, {
      focusElementForTyping: { focused: true, kind: 'input', valueInput: true, x: 24, y: 48 },
      setFocusedInputValue: { error: 'Invalid value; the field was not changed.' },
      readActiveElementState: {},
      readPageActionState: {},
    })
    const result = await driver.executeTool('chat-test', 'browser_type', {
      elementId: 0,
      text: 'invalid-date',
    })
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Invalid value') })
    expect(
      vi
        .mocked(contents.executeJavaScript)
        .mock.calls.filter(([expression]) => isPageCall(String(expression), 'typeIntoElement'))
    ).toHaveLength(0)
    expect(cdpCalls(contents, 'Input.insertText')).toHaveLength(0)
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

  it('rejects an unsupported browser_scroll direction instead of treating it as down', async () => {
    const contents = await openPage()

    const result = await driver.executeTool('chat-test', 'browser_scroll', {
      direction: 'sideways',
    })

    expect(result).toMatchObject({
      ok: false,
      error: 'Scroll direction must be "up", "down", "left", or "right".',
    })
    expect(
      vi
        .mocked(contents.executeJavaScript)
        .mock.calls.some(([expression]) => isPageCall(String(expression), 'scrollPage'))
    ).toBe(false)
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

  it('stops a batch at the first failed action and keeps earlier results', async () => {
    const contents = await openPage()
    vi.mocked(contents.executeJavaScript).mockImplementation((expression: string) => {
      if (!isPageCall(expression, 'clickElement')) return Promise.resolve(undefined)
      return Promise.resolve(
        mousePresses(contents) > 0 ? { error: 'obstructed', blocker: 'IMG' } : CLICK_TARGET
      )
    })

    const result = await driver.executeTool('chat-test', 'browser_batch', {
      actions: [
        { tool: 'browser_click', args: { elementId: 0 } },
        { tool: 'browser_click', args: { elementId: 0 } },
        { tool: 'browser_click', args: { elementId: 0 } },
      ],
    })

    expect(mousePresses(contents)).toBe(1)
    expect(result).toMatchObject({
      ok: true,
      result: {
        completed: false,
        completedCount: 1,
        stoppedIndex: 1,
        stoppedBy: 'failure',
        error: expect.stringContaining('covered by IMG'),
      },
    })
  })

  it('stops a batch after an action navigates the page', async () => {
    const contents = await openPage()
    respondWith(contents, {})
    const sendCommand = vi.mocked(contents.debugger.sendCommand)
    const dispatch = sendCommand.getMockImplementation()
    sendCommand.mockImplementation((method, params) => {
      if (method === 'Input.dispatchMouseEvent' && toRecord(params).type === 'mouseReleased') {
        emitContentsEvent(contents, 'did-navigate')
      }
      return dispatch?.(method, params) ?? Promise.resolve(undefined)
    })

    const result = await driver.executeTool('chat-test', 'browser_batch', {
      actions: [
        { tool: 'browser_click', args: { elementId: 0 } },
        { tool: 'browser_click', args: { elementId: 0 } },
      ],
    })

    expect(mousePresses(contents)).toBe(1)
    expect(result).toMatchObject({
      ok: true,
      result: { completed: false, completedCount: 1, stoppedIndex: 1, stoppedBy: 'page-change' },
    })
  })

  it('reports a batch cancelled during its first action as an unknown outcome', async () => {
    const contents = await openPage()
    respondWith(contents, {})
    const sendCommand = vi.mocked(contents.debugger.sendCommand)
    const dispatch = sendCommand.getMockImplementation()
    sendCommand.mockImplementation((method, params) =>
      method === 'Input.dispatchKeyEvent'
        ? new Promise(() => {})
        : (dispatch?.(method, params) ?? Promise.resolve(undefined))
    )

    const pending = driver.executeTool(
      'chat-test',
      'browser_batch',
      {
        actions: [
          { tool: 'browser_press_key', args: { key: 'Enter' } },
          { tool: 'browser_click', args: { elementId: 0 } },
        ],
      },
      'batch-first-call'
    )
    await vi.waitFor(() => expect(cdpCalls(contents, 'Input.dispatchKeyEvent')).toHaveLength(1))
    driver.cancelTool('chat-test', 'batch-first-call')

    await expect(pending).resolves.toMatchObject({
      ok: true,
      result: { outcomeUnknown: true, doNotRetry: true },
    })
  })

  it('rejects batches that name non-action tools or observe per action', async () => {
    await openPage()

    const navigation = await driver.executeTool('chat-test', 'browser_batch', {
      actions: [
        { tool: 'browser_navigate', args: { url: 'https://example.com' } },
        { tool: 'browser_click', args: { elementId: 0 } },
      ],
    })
    const observed = await driver.executeTool('chat-test', 'browser_batch', {
      actions: [
        { tool: 'browser_click', args: { elementId: 0, observe: {} } },
        { tool: 'browser_click', args: { elementId: 0 } },
      ],
    })

    expect(navigation).toMatchObject({
      ok: false,
      error: expect.stringContaining('Batch action 0'),
    })
    expect(observed).toMatchObject({ ok: false, error: expect.stringContaining('cannot observe') })

    const held = await driver.executeTool('chat-test', 'browser_batch', {
      actions: [
        { tool: 'browser_click', args: { elementId: 0, holdMs: 2000 } },
        { tool: 'browser_click', args: { elementId: 0 } },
      ],
    })
    expect(held).toMatchObject({
      ok: false,
      error: expect.stringContaining('cannot press and hold'),
    })
  })

  it('keeps element ids valid when an observed action is refused before dispatch', async () => {
    const contents = await openPage()
    respondWith(contents, { clickElement: { error: 'obstructed', blocker: 'IMG' } })

    const refused = await driver.executeTool('chat-test', 'browser_click', {
      elementId: 0,
      observe: {},
    })
    respondWith(contents, {})
    const retried = await driver.executeTool('chat-test', 'browser_click', { elementId: 0 })

    expect(refused).toEqual({
      ok: false,
      error: expect.stringContaining('That element is covered by IMG'),
    })
    expect(retried).toMatchObject({ ok: true, result: { dispatched: true } })
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

  it('answers a dialog opened by an action with that action dialog response only', async () => {
    const contents = await openPage()
    respondWith(contents, {
      describePointTarget: { found: true, element: 'button "Delete"', editable: false },
      readActiveElementState: {},
      readPageActionState: {},
    })
    const listener = vi
      .mocked(contents.debugger.on)
      .mock.calls.find(([event]) => event === 'message')?.[1] as
      | ((event: unknown, method: string, params: unknown, sessionId?: string) => void)
      | undefined
    const send = vi.mocked(contents.debugger.sendCommand)
    const dispatch = send.getMockImplementation()
    send.mockImplementation(async (method, params, ...rest) => {
      if (method === 'Input.dispatchMouseEvent' && params?.type === 'mouseReleased') {
        listener?.({}, 'Page.javascriptDialogOpening', { type: 'confirm', message: 'Delete?' })
      }
      return dispatch?.(method, params, ...rest)
    })

    const accepted = await driver.executeTool('chat-test', 'browser_click_at', {
      x: 10,
      y: 20,
      dialog: { accept: true },
    })
    const dismissed = await driver.executeTool('chat-test', 'browser_click_at', { x: 10, y: 20 })
    await driver.executeTool('chat-test', 'browser_list_tabs', {})

    const answers = cdpCalls(contents, 'Page.handleJavaScriptDialog').map(([, answer]) => answer)
    expect(answers).toEqual([{ accept: true }, { accept: false }])
    expect(accepted).toMatchObject({ ok: true })
    expect(dismissed).toMatchObject({ ok: true })
  })

  it('dismisses background tab dialogs while the action target accepts its dialog', async () => {
    const background = await openPage()
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    const contents = session.requireAutomationTab().view.webContents
    vi.mocked(contents.getURL).mockReturnValue('https://example.com/target')
    respondWith(contents, {
      describePointTarget: { found: true, element: 'button "Delete"', editable: false },
      readActiveElementState: {},
      readPageActionState: {},
    })
    const listeners = [background, contents].map(
      (tab) =>
        vi.mocked(tab.debugger.on).mock.calls.find(([event]) => event === 'message')?.[1] as
          | ((event: unknown, method: string, params: unknown) => void)
          | undefined
    )
    vi.mocked(contents.debugger.sendCommand).mockImplementation(async (method, params) => {
      if (method === 'Input.dispatchMouseEvent' && params?.type === 'mouseReleased') {
        for (const listener of listeners) {
          listener?.({}, 'Page.javascriptDialogOpening', { type: 'confirm', message: 'Delete?' })
        }
      }
      return {}
    })

    await expect(
      driver.executeTool('chat-test', 'browser_click_at', {
        x: 10,
        y: 20,
        dialog: { accept: true },
      })
    ).resolves.toMatchObject({ ok: true })

    expect(cdpCalls(background, 'Page.handleJavaScriptDialog').map(([, answer]) => answer)).toEqual(
      [{ accept: false }]
    )
    expect(cdpCalls(contents, 'Page.handleJavaScriptDialog').map(([, answer]) => answer)).toEqual([
      { accept: true },
    ])
  })

  describe('file uploads', () => {
    it('retains one input handle through staging and releases it after uploading', async () => {
      const contents = await openPage()
      respondWith(contents, { readPageActionState: {} })
      const input = { objectId: 'isolated-input', multiple: true, accept: '.pdf' }
      const resolve = vi.spyOn(cdp, 'resolveFileInput').mockResolvedValue(input)
      const setFiles = vi
        .spyOn(cdp, 'setFileInputFiles')
        .mockResolvedValue({ files: [{ name: 'a.pdf', size: 3 }] })
      const release = vi.spyOn(cdp, 'releaseFileInput').mockResolvedValue()
      stageUploadFiles.mockResolvedValue(['/staged/a.pdf'])

      const result = await driver.executeTool(
        'chat-test',
        'browser_upload_file',
        { elementId: 0, paths: ['files/a.pdf'] },
        'call-upload'
      )

      expect(result).toMatchObject({
        ok: true,
        result: { uploaded: [{ name: 'a.pdf', size: 3 }], effectObserved: true, accept: '.pdf' },
      })
      expect(resolve).toHaveBeenCalledWith(
        contents,
        contents.mainFrame,
        expect.stringContaining('function resolveFileInputTarget(')
      )
      expect(stageUploadFiles).toHaveBeenCalledWith(
        expect.objectContaining({ toolCallId: 'call-upload', paths: ['files/a.pdf'] })
      )
      expect(setFiles).toHaveBeenCalledWith(
        contents,
        input,
        ['/staged/a.pdf'],
        expect.any(AbortSignal),
        expect.any(Function)
      )
      expect(release).toHaveBeenCalledWith(contents, input)
      expect(resolve).toHaveBeenCalledTimes(1)
    })

    it.each(['staging', 'attachment'])(
      'releases the pinned input after %s fails before dispatch',
      async (failure) => {
        const contents = await openPage()
        const input = { objectId: 'isolated-input', multiple: false }
        vi.spyOn(cdp, 'resolveFileInput').mockResolvedValue(input)
        const setFiles = vi
          .spyOn(cdp, 'setFileInputFiles')
          .mockRejectedValue(new Error('attachment failed'))
        const release = vi.spyOn(cdp, 'releaseFileInput').mockResolvedValue()
        stageUploadFiles.mockReset()
        if (failure === 'staging') stageUploadFiles.mockRejectedValue(new Error('staging failed'))
        else stageUploadFiles.mockResolvedValue(['/staged/a.pdf'])

        const result = await driver.executeTool(
          'chat-test',
          'browser_upload_file',
          { elementId: 0, paths: ['files/a.pdf'] },
          'call-failed'
        )

        expect(result).toEqual({
          ok: false,
          error: expect.stringContaining(`${failure} failed`),
        })
        if (failure === 'staging') expect(setFiles).not.toHaveBeenCalled()
        expect(release).toHaveBeenCalledTimes(1)
        expect(release).toHaveBeenCalledWith(contents, input)
      }
    )

    it.each(['cancelled', 'timed out'] as const)(
      'reports an unconfirmed upload when its acknowledgment is %s without replaying it or affecting queued work',
      async (stop) => {
        const contents = await openPage()
        const input = { objectId: 'isolated-input', multiple: false }
        vi.spyOn(cdp, 'resolveFileInput').mockResolvedValue(input)
        let acknowledgeUpload: () => void = () => {}
        const acknowledgment = new Promise<void>((resolve) => {
          acknowledgeUpload = resolve
        })
        let appliedUploads = 0
        const setFiles = vi
          .spyOn(cdp, 'setFileInputFiles')
          .mockImplementation(async (_contents, _handle, _files, _signal, onDispatch) => {
            onDispatch?.('pending')
            appliedUploads++
            await acknowledgment
            onDispatch?.('acknowledged')
            return { files: [{ name: 'a.pdf', size: 3 }] }
          })
        const release = vi.spyOn(cdp, 'releaseFileInput').mockResolvedValue()
        stageUploadFiles.mockResolvedValue(['/staged/a.pdf'])
        let releaseSnapshot: (value: unknown) => void = () => {}
        const snapshot = new Promise<unknown>((resolve) => {
          releaseSnapshot = resolve
        })
        let snapshotStarted = false
        vi.mocked(contents.executeJavaScript).mockImplementation((expression) => {
          if (isPageCall(expression, 'collectSnapshot')) {
            snapshotStarted = true
            return snapshot
          }
          return Promise.resolve({})
        })

        vi.useFakeTimers()
        try {
          const timersBefore = vi.getTimerCount()
          const pending = driver.executeTool(
            'chat-test',
            'browser_upload_file',
            { elementId: 0, paths: ['files/a.pdf'] },
            'unconfirmed-upload'
          )
          await vi.advanceTimersByTimeAsync(200)
          expect(appliedUploads).toBe(1)
          const queued = driver.executeTool('chat-test', 'browser_snapshot', {}, 'next-snapshot')

          if (stop === 'cancelled') driver.cancelTool('chat-test', 'unconfirmed-upload')
          else
            await vi.advanceTimersByTimeAsync(
              driver.browserToolWatchdogMs('browser_upload_file', {})!
            )

          const result = await pending
          expect(result).toMatchObject({
            ok: true,
            result: {
              outcomeUnknown: true,
              doNotRetry: true,
              error: expect.any(String),
              note: expect.stringContaining('The action may already have run'),
            },
          })
          expect(result.result).not.toHaveProperty('dispatched')
          await vi.advanceTimersByTimeAsync(0)
          expect(snapshotStarted).toBe(true)
          expect(release).not.toHaveBeenCalled()

          acknowledgeUpload()
          await vi.advanceTimersByTimeAsync(200)
          expect(release).toHaveBeenCalledExactlyOnceWith(contents, input)
          expect(appliedUploads).toBe(1)
          expect(setFiles).toHaveBeenCalledTimes(1)
          expect(result.result).toMatchObject({ outcomeUnknown: true, doNotRetry: true })
          expect(result.result).not.toHaveProperty('dispatched')

          driver.cancelTool('chat-test', 'next-snapshot')
          await expect(queued).resolves.toEqual({
            ok: false,
            error: expect.stringContaining('cancelled'),
          })
          expect(vi.getTimerCount()).toBe(timersBefore)
        } finally {
          acknowledgeUpload()
          releaseSnapshot({ outline: 'Late snapshot', refIds: [], nextElementId: 1 })
          await vi.advanceTimersByTimeAsync(200)
          vi.useRealTimers()
        }
      }
    )
  })

  it('validates upload paths before touching the page', async () => {
    await openPage()

    const result = await driver.executeTool(
      'chat-test',
      'browser_upload_file',
      { elementId: 0, paths: [] },
      'call-empty'
    )

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('paths must list') })
  })

  it('saves only a completed download, bound to its tool call', async () => {
    await openPage()
    const completed = vi
      .spyOn(session, 'completedBrowserDownload')
      .mockReturnValueOnce({ filename: 'report.csv', savePath: '/downloads/report.csv' })
      .mockReturnValueOnce(null)
    saveDownloadToWorkspace.mockResolvedValue({
      path: 'files/report.csv',
      name: 'report.csv',
      size: 8,
    })

    const saved = await driver.executeTool(
      'chat-test',
      'browser_save_download',
      { downloadId: 'd1' },
      'call-save'
    )
    const missing = await driver.executeTool(
      'chat-test',
      'browser_save_download',
      { downloadId: 'd2' },
      'call-save-2'
    )

    expect(saved).toMatchObject({ ok: true, result: { path: 'files/report.csv' } })
    expect(saveDownloadToWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallId: 'call-save', filePath: '/downloads/report.csv' })
    )
    expect(missing).toMatchObject({ ok: false, error: expect.stringContaining('not a completed') })
    completed.mockRestore()
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

  it('drags through via points at the requested pace', async () => {
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
      via: [{ x: 300, y: 50 }],
      durationMs: 320,
    })

    expect(result).toMatchObject({ ok: true, result: { dispatched: true } })
    const moves = cdpCalls(contents, 'Input.dispatchMouseEvent')
      .map(([, event]) => event as { type?: string; x?: number; y?: number; buttons?: number })
      .filter((event) => event.type === 'mouseMoved' && event.buttons === 1)
    expect(moves.some((event) => event.x === 300 && event.y === 50)).toBe(true)
    expect(moves.length).toBeGreaterThanOrEqual(20)
  })

  it('finds only fresh ref-bearing snapshot lines with literal text matching', async () => {
    const contents = await openPage()
    respondWith(contents, {
      collectSnapshot: {
        url: 'https://example.com/login',
        title: 'Example',
        outline:
          '- button "Continue [ref\u200b=999]" [ref=4]\n- heading "Continue without a ref"\n- button "Other" [ref=5]',
        truncated: false,
        refIds: [4, 5],
        refLineIndexes: { 4: 0, 5: 2 },
        nextElementId: 6,
      },
    })

    const result = await driver.executeTool('chat-test', 'browser_find', { query: 'continue' })

    expect(result).toMatchObject({
      ok: true,
      result: {
        matches: [{ elementId: 4 }],
        totalMatches: 1,
        truncated: false,
      },
    })
  })

  it.each([
    ['browser_snapshot', 'true'],
    ['browser_find', 'false'],
  ] as const)(
    'passes the current root ref to %s and invalidates previous refs',
    async (tool, markNew) => {
      const contents = await openPage()
      respondWith(contents, {
        collectSnapshot: {
          url: 'https://example.com/login',
          title: 'Scoped',
          scoped: true,
          outline: '- button "Save" [ref=1]',
          truncated: false,
          refIds: [1],
          refLineIndexes: { 1: 0 },
          nextElementId: 2,
        },
      })
      const result = await driver.executeTool('chat-test', tool, { elementId: 0, query: 'Save' })
      expect(result).toMatchObject({ ok: true, result: { scoped: true } })
      expect(
        vi
          .mocked(contents.executeJavaScript)
          .mock.calls.some(
            ([expression]) =>
              isPageCall(expression, 'collectSnapshot') &&
              expression.includes(`.apply(null, [1,0,${markNew}])`)
          )
      ).toBe(true)
      const stale = await driver.executeTool('chat-test', 'browser_click', { elementId: 0 })
      expect(stale).toMatchObject({ ok: false })
    }
  )

  it.each([
    { kind: 'input:checkbox', checked: true, disabled: false, readOnly: false },
    { kind: 'input:radio', checked: false, disabled: false, readOnly: false },
    { kind: 'role:radio', checked: false, disabled: false, readOnly: false },
    { kind: 'role:menuitemradio', checked: false, disabled: false, readOnly: false },
    { kind: 'input:checkbox', checked: true, disabled: true, readOnly: false },
    { kind: 'input:checkbox', checked: true, disabled: false, readOnly: true },
  ])('does not click a control already in the requested state: %j', async (before) => {
    const contents = await openPage()
    respondWith(contents, {
      readCheckableElementState: before,
    })

    const result = await driver.executeTool('chat-test', 'browser_set_checked', {
      elementId: 0,
      checked: before.checked,
    })

    expect(result).toMatchObject({
      ok: true,
      result: { checked: before.checked, changed: false, dispatched: false },
    })
    expect(cdpCalls(contents, 'Input.dispatchMouseEvent')).toHaveLength(0)
  })

  it.each([
    { checked: true, kind: 'input:radio', error: 'cannot be unchecked' },
    { checked: true, kind: 'role:radio', error: 'cannot be unchecked' },
    { checked: true, kind: 'role:menuitemradio', error: 'cannot be unchecked' },
    { checked: false, kind: 'input:checkbox', disabled: true, error: 'disabled' },
    { checked: false, kind: 'input:checkbox', readOnly: true, error: 'read-only' },
  ])('rejects a prohibited state change: %j', async (before) => {
    const contents = await openPage()
    respondWith(contents, { readCheckableElementState: before })
    const result = await driver.executeTool('chat-test', 'browser_set_checked', {
      elementId: 0,
      checked: !before.checked,
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain(before.error)
    expect(cdpCalls(contents, 'Input.dispatchMouseEvent')).toHaveLength(0)
  })

  it.each([false, 'mixed'])(
    'uses the trusted click path from %s and verifies a changed checkable control',
    async (initialState) => {
      const contents = await openPage()
      let stateReads = 0
      vi.mocked(contents.executeJavaScript).mockImplementation((expression: string) => {
        if (isPageCall(expression, 'readCheckableElementState')) {
          stateReads++
          return Promise.resolve({
            checked: stateReads > 1 ? true : initialState,
            disabled: false,
            readOnly: false,
            kind: 'input:checkbox',
          })
        }
        if (isPageCall(expression, 'clickElement')) {
          return Promise.resolve({ dispatched: false, x: 24, y: 48, element: 'Checkbox' })
        }
        if (isPageCall(expression, 'readPageActionState')) {
          return Promise.resolve({
            url: 'https://example.com/login',
            title: 'Example',
            focus: 'body',
            mutationRevision: 0,
            dialogs: [],
            scroll: [0],
          })
        }
        if (isPageCall(expression, 'readActiveElementState')) return Promise.resolve({})
        return Promise.resolve(undefined)
      })

      const result = await driver.executeTool('chat-test', 'browser_set_checked', {
        elementId: 0,
        checked: true,
      })

      expect(result).toMatchObject({
        ok: true,
        result: { checked: true, changed: true, dispatched: true, trusted: true },
      })
      expect(cdpCalls(contents, 'Input.dispatchMouseEvent')).toHaveLength(3)
    }
  )

  it.each([true, false])(
    'polls delayed checkable state without redispatching input (updates=%s)',
    async (updates) => {
      const contents = await openPage()
      let reads = 0
      vi.mocked(contents.executeJavaScript).mockImplementation(async (expression: string) => {
        if (isPageCall(expression, 'readCheckableElementState')) {
          reads++
          return { checked: updates && reads >= 4, kind: 'input:checkbox' }
        }
        if (isPageCall(expression, 'clickElement'))
          return { dispatched: false, x: 24, y: 48, element: 'Checkbox' }
        if (isPageCall(expression, 'readPageActionState'))
          return {
            url: 'https://example.com/login',
            title: 'Example',
            focus: 'body',
            mutationRevision: 0,
            dialogs: [],
            scroll: [0],
          }
        if (isPageCall(expression, 'readActiveElementState')) return {}
      })
      vi.useFakeTimers()
      try {
        const pending = driver.executeTool('chat-test', 'browser_set_checked', {
          elementId: 0,
          checked: true,
        })
        await vi.advanceTimersByTimeAsync(2000)
        const result = await pending
        expect(result.ok).toBe(updates)
        expect(reads).toBeGreaterThanOrEqual(4)
        expect(cdpCalls(contents, 'Input.dispatchMouseEvent')).toHaveLength(3)
        if (!updates) expect(result.error).toContain('did not reach the requested checked state')
      } finally {
        vi.useRealTimers()
      }
    }
  )

  it.each(['hidden', 'detached'])(
    'does not treat a failed probe as element state %s',
    async (state) => {
      const contents = await openPage()
      vi.mocked(contents.executeJavaScript).mockRejectedValue(
        new Error('Execution context destroyed')
      )
      const response = await driver.executeTool('chat-test', 'browser_wait_for', {
        elementId: 0,
        state,
        timeoutMs: 1000,
      })
      expect(response).toMatchObject({ ok: false })
      expect(response.error).toContain('Execution context destroyed')
    }
  )

  it('crops an element screenshot without changing the live viewport', async () => {
    const contents = await openPage()
    respondWith(contents, {
      getElementScreenshotRect: {
        x: 20,
        y: 30,
        width: 200,
        height: 100,
        element: 'button',
        refRecovered: false,
      },
    })
    const capture = vi.spyOn(cdp, 'captureScreenshot').mockResolvedValue({
      dataUrl: 'data:image/jpeg;base64,c2lt',
      scale: 1,
      viewport: { width: 800, height: 600 },
      imageSize: { width: 200, height: 100 },
    })

    try {
      const result = await driver.executeTool('chat-test', 'browser_screenshot', { elementId: 0 })

      expect(capture).toHaveBeenCalledWith(
        contents,
        { x: 20, y: 30, width: 200, height: 100 },
        expect.any(AbortSignal)
      )
      expect(result).toMatchObject({
        ok: true,
        result: { element: 'button', clip: { x: 20, y: 30, width: 200, height: 100 } },
      })
    } finally {
      capture.mockRestore()
    }
  })

  it('zooms by a standard step and invalidates existing element refs', async () => {
    const contents = await openPage()

    const zoomed = await driver.executeTool('chat-test', 'browser_zoom', { action: 'in' })
    const staleRef = await driver.executeTool('chat-test', 'browser_click', { elementId: 0 })

    expect(zoomed).toMatchObject({ ok: true, result: { action: 'in' } })
    expect(contents.setZoomFactor).toHaveBeenCalled()
    expect(staleRef).toMatchObject({ ok: false })
    expect(staleRef.error).toMatch(/Call browser_snapshot/)
  })

  it('returns the screenshot scale for coordinate mapping', async () => {
    const contents = await openPage()
    mockScreenshotImage(contents, { width: 1024, height: 512 })
    vi.mocked(contents.debugger.sendCommand).mockImplementation((method: string) => {
      if (method === 'Page.getLayoutMetrics') {
        return Promise.resolve({
          cssLayoutViewport: { clientWidth: 2048, clientHeight: 1024 },
        })
      }
      return Promise.resolve(undefined)
    })
    respondWith(contents, { getViewportInfo: { width: 2048, height: 1024 } })

    const result = await driver.executeTool('chat-test', 'browser_screenshot', {})

    expect(result).toMatchObject({
      ok: true,
      result: {
        scale: 0.5,
        imageSize: { width: 1024, height: 512 },
        viewport: {
          url: 'https://example.com/login',
          title: 'Example',
          width: 2048,
          height: 1024,
        },
      },
    })
    expect(
      vi
        .mocked(contents.executeJavaScript)
        .mock.calls.some(([expression]) => isPageCall(String(expression), 'getViewportInfo'))
    ).toBe(false)
  })

  it('uses the in-page CSS viewport when CDP exposes only deprecated device metrics', async () => {
    const contents = await openPage()
    mockScreenshotImage(contents, { width: 1024, height: 512 })
    vi.mocked(contents.debugger.sendCommand).mockImplementation((method: string) => {
      if (method === 'Page.getLayoutMetrics') {
        return Promise.resolve({ layoutViewport: { clientWidth: 2048, clientHeight: 1024 } })
      }
      return Promise.resolve(undefined)
    })
    respondWith(contents, {
      getViewportInfo: {
        url: 'https://example.com/login',
        title: 'Example',
        width: 1024,
        height: 512,
      },
    })

    const result = await driver.executeTool('chat-test', 'browser_screenshot', {})

    expect(result).toMatchObject({
      ok: true,
      result: {
        scale: 1,
        viewport: {
          url: 'https://example.com/login',
          title: 'Example',
          width: 1024,
          height: 512,
        },
      },
    })
    if (
      !result.ok ||
      typeof result.result !== 'object' ||
      result.result === null ||
      !('scale' in result.result) ||
      typeof result.result.scale !== 'number'
    ) {
      throw new Error('browser_screenshot did not return a numeric coordinate scale')
    }
    expect(1024 / result.result.scale).toBe(1024)
    expect(
      vi
        .mocked(contents.executeJavaScript)
        .mock.calls.some(([expression]) => isPageCall(String(expression), 'getViewportInfo'))
    ).toBe(true)
  })

  it('rejects coordinate mapping when the viewport changes during capture', async () => {
    const contents = await openPage()
    mockScreenshotImage(contents, { width: 1024, height: 256 })
    vi.mocked(contents.debugger.sendCommand).mockImplementation((method: string) => {
      if (method === 'Page.getLayoutMetrics') {
        return Promise.resolve({ layoutViewport: { clientWidth: 1024, clientHeight: 256 } })
      }
      return Promise.resolve(undefined)
    })
    respondWith(contents, {
      getViewportInfo: {
        url: 'https://example.com/login',
        title: 'Example',
        width: 1024,
        height: 512,
      },
    })

    const result = await driver.executeTool('chat-test', 'browser_screenshot', {})

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/viewport changed while the screenshot was captured/)
  })

  it('rejects a screenshot when the document navigates during capture', async () => {
    const contents = await openPage()
    mockScreenshotImage(contents, { width: 1024, height: 512 })
    vi.mocked(contents.debugger.sendCommand).mockImplementation((method: string) => {
      if (method === 'Page.getLayoutMetrics') {
        return Promise.resolve({
          cssLayoutViewport: { clientWidth: 2048, clientHeight: 1024 },
        })
      }
      return Promise.resolve(undefined)
    })

    const image = await contents.capturePage()
    vi.mocked(contents.capturePage).mockImplementation(async () => {
      emitContentsEvent(contents, 'did-navigate')
      return image
    })

    const result = await driver.executeTool('chat-test', 'browser_screenshot', {})

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/page changed while its screenshot was being captured/)
  })
})
