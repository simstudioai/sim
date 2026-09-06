import { BROWSER_TOOL_QUEUE_WAIT_TIMEOUT_MS } from '@sim/browser-protocol'
import type { MenuItemConstructorOptions } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { BrowserWindow, Menu, nativeImage } from 'electron'
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
    const grant = vi.spyOn(session, 'grantSiteOriginForAgentNavigation')
    const result = await driver.executeTool('chat-test', 'browser_navigate', {
      url: 'file:///etc/passwd',
    })
    expect(result).toEqual({
      ok: false,
      error: 'URL must be absolute and start with http:// or https://',
    })
    expect(grant).not.toHaveBeenCalled()
  })

  it('reports missing required parameters by name', async () => {
    const result = await driver.executeTool('chat-test', 'browser_navigate', {})
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Missing required parameter "url"/)
  })

  it('grants only SSRF-checked agent navigation destinations before loading them', async () => {
    const grant = vi.spyOn(session, 'grantSiteOriginForAgentNavigation')
    const navigations = [
      ['browser_navigate', 'http://127.0.0.1:4011/navigate'],
      ['browser_open_url', 'http://127.0.0.1:4012/open'],
      ['browser_open_tab', 'http://127.0.0.1:4013/tab'],
    ] as const

    for (const [tool, url] of navigations) {
      await expect(driver.executeTool('chat-test', tool, { url })).resolves.toMatchObject({
        ok: true,
      })
      expect(grant).toHaveBeenCalledWith(expect.anything(), url)
    }
    expect(grant).toHaveBeenCalledTimes(navigations.length)
  })

  it('keeps the 400ms hydration grace without rediscovering a completed load', async () => {
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    const contents = session.requireTab().view.webContents
    vi.useFakeTimers()
    try {
      let settled = false
      const navigation = driver.executeTool('chat-test', 'browser_navigate', {
        url: 'http://127.0.0.1/loaded',
      })
      void navigation.then(() => {
        settled = true
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(contents.loadURL).toHaveBeenCalledWith('http://127.0.0.1/loaded')

      await vi.advanceTimersByTimeAsync(399)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(settled).toBe(true)
      await expect(navigation).resolves.toMatchObject({ ok: true })
    } finally {
      vi.useRealTimers()
    }
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

  it('lists safe download metadata without opening a page', async () => {
    const result = await driver.executeTool('chat-test', 'browser_list_downloads', {})

    expect(result).toEqual({
      ok: true,
      result: { scopeId: 'chat-test', downloads: [] },
    })
    expect(session.peekTabsState().tabs).toEqual([])
  })

  it('reloads the active tab and waits for its load boundary', async () => {
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    const contents = session.requireTab().view.webContents
    vi.useFakeTimers()
    try {
      const reload = driver.executeTool('chat-test', 'browser_reload', {})
      await vi.advanceTimersByTimeAsync(500)

      await expect(reload).resolves.toMatchObject({ ok: true })
      expect(contents.reload).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
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

  it('does not let a detached takeover poll touch a disposed scope', async () => {
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    vi.useFakeTimers()
    const hasSession = vi.spyOn(session, 'hasSession')
    try {
      const takeover = driver.executeTool(
        'chat-test',
        'browser_request_takeover',
        { reason: 'Please finish in the browser' },
        'tool-disposed-takeover'
      )
      await vi.advanceTimersByTimeAsync(0)

      driver.disposeBrowserScope('chat-test')
      hasSession.mockClear()
      await expect(takeover).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('cancelled'),
      })
      await vi.advanceTimersByTimeAsync(1_500)

      expect(hasSession).not.toHaveBeenCalled()
    } finally {
      hasSession.mockRestore()
      vi.useRealTimers()
    }
  })

  it('does not let a detached text wait touch a disposed scope', async () => {
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    const contents = session.requireTab().view.webContents
    vi.mocked(contents.getURL).mockReturnValue('https://example.com/')
    let resolvePageProbe: (value: boolean) => void = () => {}
    vi.mocked(contents.executeJavaScript).mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolvePageProbe = resolve
        })
    )
    vi.useFakeTimers()
    const automationTab = vi.spyOn(session, 'automationTab')
    try {
      const waiting = driver.executeTool(
        'chat-test',
        'browser_wait_for',
        { text: 'ready', timeoutMs: 120_000 },
        'tool-disposed-wait'
      )
      await vi.advanceTimersByTimeAsync(0)
      expect(contents.executeJavaScript).toHaveBeenCalled()

      driver.disposeBrowserScope('chat-test')
      automationTab.mockClear()
      await expect(waiting).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('cancelled'),
      })
      resolvePageProbe(false)
      await vi.advanceTimersByTimeAsync(300)

      expect(automationTab).not.toHaveBeenCalled()
    } finally {
      automationTab.mockRestore()
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

      driver.disposeBrowserScope('chat-test')
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

  it('captures a missing scope without materializing driver state', async () => {
    const boundary = driver.captureBrowserToolQueueBoundary('chat-not-yet-active')
    expect(boundary).not.toBeNull()
    if (!boundary) throw new Error('Expected browser tool authorization admission')

    expect(boundary).toMatchObject({
      scopeId: 'chat-not-yet-active',
      generation: null,
      cancellationEpoch: null,
    })

    driver.activateBrowserScope('chat-not-yet-active')
    await expect(
      driver.executeTool(
        'chat-not-yet-active',
        'browser_list_tabs',
        {},
        'tool-authorized-before-activation',
        boundary
      )
    ).resolves.toMatchObject({ ok: true })
  })

  it('rejects a missing-scope authorization after process-wide browser teardown', async () => {
    const boundary = driver.captureBrowserToolQueueBoundary('chat-not-yet-active')
    expect(boundary).not.toBeNull()
    if (!boundary) throw new Error('Expected browser tool authorization admission')
    driver.closeBrowserSession()
    driver.activateBrowserScope('chat-not-yet-active')

    await expect(
      driver.executeTool(
        'chat-not-yet-active',
        'browser_list_tabs',
        {},
        'tool-authorized-before-global-close',
        boundary
      )
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('cancelled before it started'),
    })
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

  it('rejects a first-use authorization after its scope is suspended and reopened', async () => {
    const boundary = driver.captureBrowserToolQueueBoundary('chat-first-use-suspended')
    expect(boundary).not.toBeNull()
    if (!boundary) throw new Error('Expected browser tool authorization admission')

    expect(driver.suspendBrowserScope('chat-first-use-suspended')).toBe(true)
    driver.activateBrowserScope('chat-first-use-suspended')

    await expect(
      driver.executeTool(
        'chat-first-use-suspended',
        'browser_open_tab',
        {},
        'tool-authorized-before-first-use-suspension',
        boundary
      )
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('cancelled before it started'),
    })
    expect(
      session.withBrowserScope('chat-first-use-suspended', () => session.peekTabsState()).tabs
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

  it('rejects an existing-scope authorization after disposal and recreation', async () => {
    const boundary = driver.captureBrowserToolQueueBoundary('chat-test')
    expect(boundary).not.toBeNull()
    if (!boundary) throw new Error('Expected browser tool authorization admission')

    driver.disposeBrowserScope('chat-test')
    driver.activateBrowserScope('chat-test')

    await expect(
      driver.executeTool(
        'chat-test',
        'browser_list_tabs',
        {},
        'tool-authorized-before-scope-disposal',
        boundary
      )
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('cancelled before it started'),
    })
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

  it('retains disposed-scope authorization admissions until their fetches settle', () => {
    const boundaries = capturePendingAuthorizations(driver, 'chat-disposed-authorizations')

    driver.disposeBrowserScope('chat-disposed-authorizations')
    expect(boundaries.every((boundary) => boundary.cancelled)).toBe(true)
    expect(driver.captureBrowserToolQueueBoundary('chat-disposed-authorizations')).toBeNull()

    releasePendingAuthorizations(driver, boundaries)
    const replacement = driver.captureBrowserToolQueueBoundary('chat-disposed-authorizations')
    expect(replacement).not.toBeNull()
    if (replacement) driver.releaseBrowserToolQueueBoundary(replacement)
  })

  it('retains suspended-scope authorization admissions until their fetches settle', () => {
    const boundaries = capturePendingAuthorizations(driver, 'chat-suspended-authorizations')

    expect(driver.suspendBrowserScope('chat-suspended-authorizations')).toBe(true)
    expect(boundaries.every((boundary) => boundary.cancelled)).toBe(true)
    expect(driver.captureBrowserToolQueueBoundary('chat-suspended-authorizations')).toBeNull()

    releasePendingAuthorizations(driver, boundaries)
    const replacement = driver.captureBrowserToolQueueBoundary('chat-suspended-authorizations')
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

  it('routes an exact renderer site decision through the scoped session boundary', async () => {
    const respond = vi.spyOn(session, 'respondToSitePermission').mockReturnValue(true)

    await driver.handlePanelAction('chat-test', {
      action: 'respond-site-permission',
      requestId: 'request-1',
      allowed: true,
    })
    await driver.handlePanelAction('chat-test', {
      action: 'respond-site-permission',
      requestId: 'request-2',
    })

    expect(respond).toHaveBeenCalledOnce()
    expect(respond).toHaveBeenCalledWith('request-1', true)
  })

  it('grants only the exact origin entered through the user omnibox', async () => {
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    const contents = session.requireTab().view.webContents
    const grant = vi.spyOn(session, 'grantSiteOriginForUserNavigation')

    await driver.handlePanelAction('chat-test', {
      action: 'navigate',
      url: 'https://docs.example/private?token=secret',
    })

    expect(grant).toHaveBeenCalledOnce()
    expect(grant).toHaveBeenCalledWith(contents, 'https://docs.example/private?token=secret')
    expect(contents.loadURL).toHaveBeenCalledWith('https://docs.example/private?token=secret')
  })

  it('waits for a selected restored tab before reporting it ready to the model', async () => {
    await driver.executeTool('chat-test', 'browser_open_tab', {})
    const tab = session.requireTab()
    let releaseRestore = () => {}
    const wait = vi.spyOn(session, 'waitForPendingTabRestore').mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          releaseRestore = () => resolve(true)
        })
    )
    let settled = false
    const switched = driver
      .executeTool('chat-test', 'browser_switch_tab', { tabId: tab.id })
      .then((result) => {
        settled = true
        return result
      })

    await Promise.resolve()
    expect(settled).toBe(false)
    expect(wait).toHaveBeenCalledWith(tab)

    releaseRestore()
    await expect(switched).resolves.toMatchObject({
      ok: true,
      result: { tabId: tab.id },
    })
    wait.mockRestore()
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

  it('allows a fifty-second restored-tab consent and load without duplicating the tab', async () => {
    vi.useFakeTimers()
    try {
      await driver.executeTool('chat-test', 'browser_open_tab', {})
      const tab = session.requireTab()
      const wait = vi.spyOn(session, 'waitForPendingTabRestore').mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            setTimeout(() => resolve(true), 50_000)
          })
      )

      const switched = driver.executeTool('chat-test', 'browser_switch_tab', { tabId: tab.id })
      await vi.advanceTimersByTimeAsync(50_000)

      await expect(switched).resolves.toMatchObject({
        ok: true,
        result: { tabId: tab.id },
      })
      expect(session.listTabs()).toHaveLength(1)
      expect(session.requireTab()).toBe(tab)
      wait.mockRestore()
    } finally {
      vi.useRealTimers()
    }
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

  it('retains replaced destination admissions until their authorization fetches settle', async () => {
    await driver.executeTool('pending:new-chat', 'browser_open_tab', {})
    driver.activateBrowserScope('chat-real')
    const sourceBoundary = driver.captureBrowserToolQueueBoundary('pending:new-chat')
    const destinationBoundaries = capturePendingAuthorizations(
      driver,
      'chat-real',
      driver.BROWSER_TOOL_ADMISSION_LIMITS.perScope - 1
    )
    expect(sourceBoundary).not.toBeNull()
    if (!sourceBoundary) throw new Error('Expected source authorization admission')

    expect(driver.migrateBrowserScope('pending:new-chat', 'chat-real')).toBe(true)

    expect(destinationBoundaries.every((boundary) => boundary.cancelled)).toBe(true)
    expect(sourceBoundary.cancelled).toBe(false)
    expect(driver.captureBrowserToolQueueBoundary('chat-real')).toBeNull()

    releasePendingAuthorizations(driver, destinationBoundaries)
    await expect(
      driver.executeTool(
        'chat-real',
        'browser_list_tabs',
        {},
        'tool-source-after-destination-settlement',
        sourceBoundary
      )
    ).resolves.toMatchObject({ ok: true })
    const replacement = driver.captureBrowserToolQueueBoundary('chat-real')
    expect(replacement).not.toBeNull()
    if (replacement) driver.releaseBrowserToolQueueBoundary(replacement)
  })

  it('keeps migrated source admissions charged to the durable scope after disposal', () => {
    driver.activateBrowserScope('pending:new-chat')
    const sourceBoundaries = capturePendingAuthorizations(driver, 'pending:new-chat')

    expect(driver.migrateBrowserScope('pending:new-chat', 'chat-real')).toBe(true)
    expect(sourceBoundaries.every((boundary) => boundary.scopeId === 'chat-real')).toBe(true)

    driver.disposeBrowserScope('chat-real')
    driver.activateBrowserScope('chat-real')
    expect(sourceBoundaries.every((boundary) => boundary.cancelled)).toBe(true)
    expect(driver.captureBrowserToolQueueBoundary('chat-real')).toBeNull()

    releasePendingAuthorizations(driver, sourceBoundaries)
    const replacement = driver.captureBrowserToolQueueBoundary('chat-real')
    expect(replacement).not.toBeNull()
    if (replacement) driver.releaseBrowserToolQueueBoundary(replacement)
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

  it('bounds process-wide queues across scopes and recovers capacity on disposal', async () => {
    vi.useFakeTimers()
    const scopes = Array.from(
      {
        length:
          driver.BROWSER_TOOL_ADMISSION_LIMITS.process /
          driver.BROWSER_TOOL_ADMISSION_LIMITS.perScope,
      },
      (_, index) => `chat-admission-${index}`
    )
    const executions: Array<Promise<{ ok: boolean }>> = []
    try {
      for (const scopeId of scopes) {
        await driver.executeTool(scopeId, 'browser_open_tab', {})
        const contents = session.withBrowserScope(
          scopeId,
          () => session.requireTab().view.webContents
        )
        vi.mocked(contents.getURL).mockReturnValue('https://example.com/')
        vi.mocked(contents.executeJavaScript).mockImplementation(() => new Promise<never>(() => {}))
        executions.push(
          driver.executeTool(scopeId, 'browser_snapshot', {}, `held-process-${scopeId}`)
        )
        await vi.advanceTimersByTimeAsync(0)
        for (let index = 1; index < driver.BROWSER_TOOL_ADMISSION_LIMITS.perScope; index++) {
          executions.push(
            driver.executeTool(
              scopeId,
              'browser_list_tabs',
              {},
              `queued-process-${scopeId}-${index}`
            )
          )
        }
      }

      await expect(
        driver.executeTool('chat-process-overflow', 'browser_list_tabs', {}, 'process-overflow')
      ).resolves.toEqual({
        ok: false,
        error:
          'Sim already has too many browser actions queued. Wait for earlier actions to finish.',
      })

      driver.disposeBrowserScope(scopes[0])
      await expect(
        driver.executeTool('chat-process-recovered', 'browser_list_tabs', {}, 'process-recovered')
      ).resolves.toMatchObject({ ok: true })
    } finally {
      for (const scopeId of scopes) driver.disposeBrowserScope(scopeId)
      await Promise.allSettled(executions)
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

  it.each([
    { fields: [] },
    {
      fields: Array.from({ length: 9 }, (_, elementId) => ({ elementId, kind: 'text', text: 'x' })),
    },
    { fields: [formFields[0], { ...formFields[1], submit: true }] },
    { fields: [formFields[0], formFields[0]] },
    { fields: [{ elementId: 0, kind: 'text', text: 'x'.repeat(4097) }] },
  ])('validates the entire bounded form payload before writing', async (params) => {
    const form = await openForm()
    expect(await driver.executeTool('chat-test', 'browser_fill_form', params)).toMatchObject({
      ok: false,
    })
    expect(form.writes).toEqual([])
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

  it('stops before the next field after same-document navigation', async () => {
    const form: Awaited<ReturnType<typeof openForm>> = await openForm({
      afterWrite: () => vi.mocked(form.contents.getURL).mockReturnValue('https://example.com/next'),
    })
    const result = await driver.executeTool('chat-test', 'browser_fill_form', {
      fields: formFields,
    })
    expect(form.writes).toEqual([0])
    expect(result).toMatchObject({ ok: true, result: { completed: false, doNotRetry: true } })
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

  function mockScreenshotImage(size: { width: number; height: number } | null): void {
    vi.mocked(nativeImage.createFromBuffer).mockReturnValueOnce({
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

  it('accepts empty text and sends it through native insertion to clear a field', async () => {
    const contents = await openPage()
    respondWith(contents, {
      focusElementForTyping: { focused: true, kind: 'input', x: 24, y: 48 },
      readActiveElementState: { activeElement: 'input', valueLength: 0, valuePreview: '' },
      readPageActionState: {},
    })

    const result = await driver.executeTool('chat-test', 'browser_type', { elementId: 0, text: '' })

    expect(result).toMatchObject({ ok: true, result: { dispatched: true, trusted: true } })
    expect(cdpCalls(contents, 'Input.insertText')).toEqual([['Input.insertText', { text: '' }]])
  })

  it.each([{}, { text: undefined }, { text: null }, { text: 7 }, { text: false }])(
    'rejects missing or nonstring text before native input',
    async (params) => {
      const contents = await openPage()
      const result = await driver.executeTool('chat-test', 'browser_type', {
        elementId: 0,
        ...params,
      })

      expect(result).toMatchObject({ ok: false, error: expect.stringContaining('text') })
      expect(cdpCalls(contents, 'Input.insertText')).toHaveLength(0)
      expect(cdpCalls(contents, 'Input.dispatchKeyEvent')).toHaveLength(0)
    }
  )

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

  it.each(['left', 'right'])(
    'accepts browser_scroll %s and returns horizontal movement',
    async (direction) => {
      const contents = await openPage()
      const movedBy = direction === 'left' ? -100 : 100
      respondWith(contents, {
        scrollPage: {
          target: 'Table columns',
          targetSource: 'viewport-center',
          movedBy,
          scrollLeft: 300,
          scrollWidth: 1_000,
          clientWidth: 200,
          atLeft: false,
          atRight: false,
          atTop: true,
          atBottom: true,
        },
      })

      expect(
        await driver.executeTool('chat-test', 'browser_scroll', { direction, amount: 100 })
      ).toMatchObject({
        ok: true,
        result: { movedBy, scrollLeft: 300, atLeft: false, atRight: false },
      })
    }
  )

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

  it('reports top-page effects observed after inserting text in a child frame', async () => {
    const contents = await openPage()
    const mainFrame = {
      frameTreeNodeId: 1,
      detached: false,
      isDestroyed: vi.fn(() => false),
      origin: 'https://example.com',
      parent: null,
      framesInSubtree: [] as unknown[],
    }
    const childFrame = {
      frameTreeNodeId: 2,
      detached: false,
      isDestroyed: vi.fn(() => false),
      origin: 'https://mail-widget.example',
      parent: mainFrame,
      url: 'https://mail-widget.example/compose',
    }
    mainFrame.framesInSubtree = [mainFrame, childFrame]
    Object.defineProperty(contents, 'mainFrame', { configurable: true, value: mainFrame })
    Object.defineProperty(contents, 'focusedFrame', { configurable: true, value: childFrame })
    let topPageReads = 0
    vi.mocked(contents.executeJavaScript).mockImplementation((expression: string) => {
      if (isPageCall(expression, 'readPageActionState')) {
        topPageReads++
        return Promise.resolve({
          url:
            topPageReads === 1 ? 'https://example.com/compose' : 'https://example.com/message/sent',
          title: 'Mail',
          focus: 'iframe',
          mutationRevision: topPageReads,
          dialogs: [],
          scroll: [0],
        })
      }
      return Promise.resolve(undefined)
    })
    const isolatedFrameEval = vi
      .spyOn(cdp, 'evaluateInIsolatedFrame')
      .mockImplementation((_contents, _frame, expression) => {
        if (isPageCall(expression, 'activeElementSecrecy')) return Promise.resolve('safe')
        if (isPageCall(expression, 'describeFocusedEditable')) {
          return Promise.resolve({ editable: true, kind: 'input' })
        }
        if (isPageCall(expression, 'readActiveElementState')) {
          return Promise.resolve({ activeElement: 'input', valueLength: 4 })
        }
        if (isPageCall(expression, 'readPageActionState')) {
          return Promise.resolve({
            url: 'https://mail-widget.example/compose',
            title: 'Compose',
            focus: 'input',
            mutationRevision: 0,
            dialogs: [],
            scroll: [0],
          })
        }
        return Promise.resolve(undefined)
      })

    try {
      const result = await driver.executeTool('chat-test', 'browser_insert_text', { text: 'sent' })

      expect(result.ok, result.error).toBe(true)
      expect(result).toMatchObject({
        ok: true,
        result: {
          effectObserved: true,
          possibleEffectObserved: true,
          effect: { urlChanged: true },
        },
      })
    } finally {
      isolatedFrameEval.mockRestore()
    }
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

  it.each(['browser_snapshot', 'browser_find'] as const)(
    'omits an absent scope from the serialized %s page call',
    async (tool) => {
      const contents = await openPage()
      vi.mocked(contents.executeJavaScript).mockClear()
      await driver.executeTool('chat-test', tool, { query: 'Continue' })
      const expressions = vi
        .mocked(contents.executeJavaScript)
        .mock.calls.map(([expression]) => expression)
        .filter((expression) => isPageCall(expression, 'collectSnapshot'))
      expect(expressions).toHaveLength(1)
      expect(expressions[0]).toContain('.apply(null, [1])')
    }
  )

  it.each(['browser_snapshot', 'browser_find'] as const)(
    'passes the current root ref to %s and invalidates previous refs',
    async (tool) => {
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
              expression.includes('.apply(null, [1,0])')
          )
      ).toBe(true)
      const stale = await driver.executeTool('chat-test', 'browser_click', { elementId: 0 })
      expect(stale).toMatchObject({ ok: false })
    }
  )

  it.each([
    [1, false, 1],
    [100, false, 50],
    [100, true, 50],
  ])(
    'bounds find results for maxResults=%s and snapshot truncation=%s',
    async (maxResults, truncated, expectedCount) => {
      const contents = await openPage()
      const ids = Array.from({ length: 60 }, (_, index) => index + 1)
      respondWith(contents, {
        collectSnapshot: {
          url: 'https://example.com/login',
          title: 'Example',
          outline: ids.map((id) => `- button "Continue ${id}" [ref=${id}]`).join('\n'),
          truncated,
          refIds: ids,
          refLineIndexes: Object.fromEntries(ids.map((id, index) => [id, index])),
          nextElementId: 61,
        },
      })
      const response = await driver.executeTool('chat-test', 'browser_find', {
        query: 'Continue',
        maxResults,
      })
      expect(response).toMatchObject({ ok: true, result: { totalMatches: 60, truncated: true } })
      expect((response.result as { matches: unknown[] }).matches).toHaveLength(expectedCount)
    }
  )

  it('reports incomplete search coverage even when no ref matches', async () => {
    const contents = await openPage()
    respondWith(contents, {
      collectSnapshot: {
        url: 'https://example.com/login',
        title: 'Example',
        outline: '- button "Other" [ref=1]',
        truncated: true,
        refIds: [1],
        refLineIndexes: { 1: 0 },
        nextElementId: 2,
      },
    })
    const response = await driver.executeTool('chat-test', 'browser_find', { query: 'Missing' })
    expect(response).toMatchObject({
      ok: true,
      result: { matches: [], totalMatches: 0, truncated: true },
    })
  })

  it('rejects oversized search text before taking a snapshot', async () => {
    const contents = await openPage()
    vi.mocked(contents.executeJavaScript).mockClear()
    const response = await driver.executeTool('chat-test', 'browser_find', {
      query: 'x'.repeat(4097),
    })
    expect(response).toMatchObject({ ok: false })
    expect(contents.executeJavaScript).not.toHaveBeenCalled()
  })

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

  it('waits for URL and semantic element state together', async () => {
    const contents = await openPage()
    respondWith(contents, {
      readPageActionState: {
        targetState: { present: true, rendered: true, disabled: false },
      },
    })

    const result = await driver.executeTool('chat-test', 'browser_wait_for', {
      urlContains: '/login',
      elementId: 0,
      state: 'enabled',
      timeoutMs: 1_000,
    })

    expect(result).toMatchObject({
      ok: true,
      result: { found: true, matched: ['url', 'element'] },
    })
  })

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

  it('rejects navigation while inspecting an element wait condition', async () => {
    const contents = await openPage()
    vi.mocked(contents.executeJavaScript).mockImplementation(async () => {
      vi.mocked(contents.getURL).mockReturnValue('https://example.com/next')
      return { targetState: { present: false, rendered: false } }
    })
    const response = await driver.executeTool('chat-test', 'browser_wait_for', {
      elementId: 0,
      state: 'detached',
      timeoutMs: 1000,
    })
    expect(response).toMatchObject({ ok: false })
    expect(response.error).toContain('page changed')
  })

  it.each([
    ['detached', { present: true, rendered: false }],
    ['collapsed', { present: true, rendered: true }],
    ['expanded', { present: true, rendered: true }],
    ['unchecked', { present: true, rendered: true, checked: 'mixed' }],
    ['unchecked', { present: true, rendered: true }],
  ])('does not satisfy %s from an incompatible element state', async (state, targetState) => {
    const contents = await openPage()
    respondWith(contents, { readPageActionState: { targetState } })
    vi.useFakeTimers()
    try {
      const response = driver.executeTool('chat-test', 'browser_wait_for', {
        elementId: 0,
        state,
        timeoutMs: 100,
      })
      await vi.advanceTimersByTimeAsync(1000)
      await expect(response).resolves.toMatchObject({ ok: true, result: { found: false } })
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['expanded', { open: true }],
    ['collapsed', { open: false }],
    ['expanded', { ariaExpanded: 'true' }],
    ['collapsed', { ariaExpanded: 'false' }],
  ])('waits for %s on native and ARIA disclosure controls', async (state, semanticState) => {
    const contents = await openPage()
    respondWith(contents, {
      readPageActionState: { targetState: { present: true, rendered: true, ...semanticState } },
    })
    await expect(
      driver.executeTool('chat-test', 'browser_wait_for', {
        elementId: 0,
        state,
        timeoutMs: 100,
      })
    ).resolves.toMatchObject({ ok: true, result: { found: true } })
  })

  it.each(['x', 'y', 'width', 'height', 'detached'])(
    'rejects an element screenshot when %s changes during capture',
    async (change) => {
      const contents = await openPage()
      let captured = false
      vi.mocked(contents.executeJavaScript).mockImplementation(async (expression: string) => {
        if (!isPageCall(expression, 'getElementScreenshotRect')) return undefined
        if (captured && change === 'detached') return { error: 'stale' }
        return { x: 20, y: 30, width: 200, height: 100, ...(captured ? { [change]: 50 } : {}) }
      })
      const capture = vi.spyOn(cdp, 'captureScreenshot').mockImplementation(async () => {
        captured = true
        return {
          dataUrl: 'data:image/jpeg;base64,c2lt',
          scale: 1,
          viewport: { width: 800, height: 600 },
          imageSize: { width: 200, height: 100 },
        }
      })
      try {
        const result = await driver.executeTool('chat-test', 'browser_screenshot', { elementId: 0 })
        expect(result.ok).toBe(false)
        expect(result.error).toMatch(change === 'detached' ? /stale/ : /element moved/)
        expect(capture).toHaveBeenCalledTimes(1)
      } finally {
        capture.mockRestore()
      }
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

      expect(capture).toHaveBeenCalledWith(contents, { x: 20, y: 30, width: 200, height: 100 })
      expect(result).toMatchObject({
        ok: true,
        result: { element: 'button', clip: { x: 20, y: 30, width: 200, height: 100 } },
      })
    } finally {
      capture.mockRestore()
    }
  })

  it('rejects navigation during an element screenshot measurement', async () => {
    const contents = await openPage()
    vi.mocked(contents.executeJavaScript).mockImplementation(async (expression: string) => {
      if (isPageCall(expression, 'getElementScreenshotRect')) {
        vi.mocked(contents.getURL).mockReturnValue('https://example.com/next')
        return { x: 20, y: 30, width: 200, height: 100 }
      }
    })
    const capture = vi.spyOn(cdp, 'captureScreenshot')
    try {
      const result = await driver.executeTool('chat-test', 'browser_screenshot', { elementId: 0 })
      expect(result).toMatchObject({ ok: false })
      expect(result.error).toMatch(/page changed/)
      expect(capture).not.toHaveBeenCalled()
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
    mockScreenshotImage({ width: 1024, height: 512 })
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

    expect(result).toMatchObject({
      ok: true,
      result: {
        scale: 0.5,
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
    mockScreenshotImage({ width: 1024, height: 512 })
    vi.mocked(contents.debugger.sendCommand).mockImplementation((method: string) => {
      if (method === 'Page.getLayoutMetrics') {
        return Promise.resolve({ layoutViewport: { clientWidth: 2048, clientHeight: 1024 } })
      }
      if (method === 'Page.captureScreenshot') {
        return Promise.resolve({ data: 'c2lt' })
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

  it('accepts stable truncated page identity with deprecated device metrics', async () => {
    const contents = await openPage()
    const fullUrl = `https://example.com/${'u'.repeat(5000)}`
    const fullTitle = `Example ${'t'.repeat(600)}`
    vi.mocked(contents.getURL).mockReturnValue(fullUrl)
    vi.mocked(contents.getTitle).mockReturnValue(fullTitle)
    mockScreenshotImage({ width: 1024, height: 512 })
    vi.mocked(contents.debugger.sendCommand).mockImplementation((method: string) => {
      if (method === 'Page.getLayoutMetrics') {
        return Promise.resolve({ layoutViewport: { clientWidth: 2048, clientHeight: 1024 } })
      }
      if (method === 'Page.captureScreenshot') return Promise.resolve({ data: 'c2lt' })
      return Promise.resolve(undefined)
    })
    respondWith(contents, {
      getViewportInfo: {
        url: fullUrl.slice(0, 4096),
        title: fullTitle.slice(0, 500),
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
          url: fullUrl.slice(0, 4096),
          title: fullTitle.slice(0, 500),
          width: 1024,
          height: 512,
        },
      },
    })
  })

  it('rejects an undecodable screenshot instead of returning an unverified scale', async () => {
    const contents = await openPage()
    mockScreenshotImage(null)
    vi.mocked(contents.debugger.sendCommand).mockImplementation((method: string) => {
      if (method === 'Page.getLayoutMetrics') {
        return Promise.resolve({
          cssLayoutViewport: { clientWidth: 2048, clientHeight: 1024 },
        })
      }
      if (method === 'Page.captureScreenshot') return Promise.resolve({ data: 'c2lt' })
      return Promise.resolve(undefined)
    })

    const result = await driver.executeTool('chat-test', 'browser_screenshot', {})

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/verify the screenshot dimensions/)
  })

  it('rejects a screenshot when no CSS viewport can be established', async () => {
    const contents = await openPage()
    mockScreenshotImage({ width: 1024, height: 512 })
    vi.mocked(contents.debugger.sendCommand).mockImplementation((method: string) => {
      if (method === 'Page.getLayoutMetrics') {
        return Promise.resolve({ layoutViewport: { clientWidth: 2048, clientHeight: 1024 } })
      }
      if (method === 'Page.captureScreenshot') return Promise.resolve({ data: 'c2lt' })
      return Promise.resolve(undefined)
    })
    respondWith(contents, { getViewportInfo: null })

    const result = await driver.executeTool('chat-test', 'browser_screenshot', {})

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/verify the page viewport/)
  })

  it('rejects coordinate mapping when the viewport changes during capture', async () => {
    const contents = await openPage()
    mockScreenshotImage({ width: 1024, height: 256 })
    vi.mocked(contents.debugger.sendCommand).mockImplementation((method: string) => {
      if (method === 'Page.getLayoutMetrics') {
        return Promise.resolve({ layoutViewport: { clientWidth: 1024, clientHeight: 256 } })
      }
      if (method === 'Page.captureScreenshot') return Promise.resolve({ data: 'c2lt' })
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
    mockScreenshotImage({ width: 1024, height: 512 })
    vi.mocked(contents.debugger.sendCommand).mockImplementation((method: string) => {
      if (method === 'Page.getLayoutMetrics') {
        return Promise.resolve({
          cssLayoutViewport: { clientWidth: 2048, clientHeight: 1024 },
        })
      }
      if (method === 'Page.captureScreenshot') {
        emitContentsEvent(contents, 'did-navigate')
        return Promise.resolve({ data: 'c2lt' })
      }
      return Promise.resolve(undefined)
    })

    const result = await driver.executeTool('chat-test', 'browser_screenshot', {})

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/page changed while its screenshot was being captured/)
  })

  it.each(['url', 'title'] as const)(
    'rejects a screenshot when the page %s changes during capture',
    async (identityField) => {
      const contents = await openPage()
      mockScreenshotImage({ width: 1024, height: 512 })
      const initialUrl = contents.getURL()
      const initialTitle = contents.getTitle()
      let currentUrl = initialUrl
      let currentTitle = initialTitle
      vi.mocked(contents.getURL).mockImplementation(() => currentUrl)
      vi.mocked(contents.getTitle).mockImplementation(() => currentTitle)
      vi.mocked(contents.debugger.sendCommand).mockImplementation((method: string) => {
        if (method === 'Page.getLayoutMetrics') {
          return Promise.resolve({
            cssLayoutViewport: { clientWidth: 2048, clientHeight: 1024 },
          })
        }
        if (method === 'Page.captureScreenshot') {
          if (identityField === 'url') currentUrl = 'https://example.com/changed'
          else currentTitle = 'Changed title'
          return Promise.resolve({ data: 'c2lt' })
        }
        return Promise.resolve(undefined)
      })

      const result = await driver.executeTool('chat-test', 'browser_screenshot', {})

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/page changed while its screenshot was being captured/)
    }
  )
})
