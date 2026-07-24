import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { BrowserWindow } from 'electron'

type DriverModule = typeof import('@/main/browser-agent/driver')

async function freshDriver(): Promise<DriverModule> {
  vi.resetModules()
  return await import('@/main/browser-agent/driver')
}

describe('executeTool', () => {
  let driver: DriverModule

  beforeEach(async () => {
    driver = await freshDriver()
  })

  it('returns ok:false instead of throwing for tool-level failures', async () => {
    // No session exists, so any page-dependent tool fails with guidance.
    const result = await driver.executeTool('browser_click', { elementId: 1 })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/No page is open yet/)
  })

  it('validates navigation URLs before touching the session', async () => {
    const result = await driver.executeTool('browser_navigate', { url: 'file:///etc/passwd' })
    expect(result).toEqual({
      ok: false,
      error: 'URL must be absolute and start with http:// or https://',
    })
  })

  it('reports missing required parameters by name', async () => {
    const result = await driver.executeTool('browser_navigate', {})
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Missing required parameter "url"/)
  })

  it('serializes tool calls: a queued failure never rejects the next call', async () => {
    const first = await driver.executeTool('browser_snapshot', {})
    expect(first.ok).toBe(false)
    const second = await driver.executeTool('browser_list_tabs', {})
    // list_tabs works without a session (empty list).
    expect(second.ok).toBe(true)
    expect(second.result).toMatchObject({ tabs: [] })
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
        },
        () => win
      )
      await driver.executeTool('browser_open_tab', {})

      const session = await import('@/main/browser-agent/session')
      const contents = session.requireTab().view.webContents
      vi.mocked(contents.getURL).mockReturnValue(url)
      vi.mocked(contents.executeJavaScript).mockImplementation(() => new Promise<never>(() => {}))

      const snapshot = driver.executeTool('browser_snapshot', {})
      const listTabs = driver.executeTool('browser_list_tabs', {})

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

  it('releases the serialized queue before the renderer timeout when a page call hangs', async () => {
    vi.useFakeTimers()
    try {
      const win = new BrowserWindow()
      driver.initDriver(
        {
          onPageState: vi.fn(),
          onTabsState: vi.fn(),
          onSessionStatus: vi.fn(),
        },
        () => win
      )
      await driver.executeTool('browser_open_tab', {})

      const session = await import('@/main/browser-agent/session')
      const contents = session.requireTab().view.webContents
      vi.mocked(contents.executeJavaScript).mockImplementation(() => new Promise<never>(() => {}))

      const hung = driver.executeTool('browser_snapshot', {})
      const queued = driver.executeTool('browser_list_tabs', {})
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
})

/**
 * Trusted CDP input never enters the page, so a focused credential field can
 * only be ruled out in the driver. These cover that seam; the page-side
 * detection itself is covered in page-functions.test.ts.
 */
describe('credential protection', () => {
  let driver: DriverModule

  beforeEach(async () => {
    driver = await freshDriver()
  })

  /** Opens a tab on a real URL so injected page calls are not short-circuited. */
  async function openPage() {
    const win = new BrowserWindow()
    driver.initDriver(
      { onPageState: vi.fn(), onTabsState: vi.fn(), onSessionStatus: vi.fn() },
      () => win
    )
    await driver.executeTool('browser_open_tab', {})
    const session = await import('@/main/browser-agent/session')
    const contents = session.requireTab().view.webContents
    vi.mocked(contents.getURL).mockReturnValue('https://example.com/login')
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
        if (expression.includes(fnName)) return Promise.resolve(value)
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

    const result = await driver.executeTool('browser_press_key', { key: 'a' })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Refusing to act on a password field/)
    expect(cdpCalls(contents, 'Input.dispatchKeyEvent')).toHaveLength(0)
  })

  it('refuses character insertion into a frame it cannot inspect', async () => {
    const contents = await openPage()
    respondWith(contents, { activeElementSecrecy: 'opaque' })

    const result = await driver.executeTool('browser_press_key', { key: 'a' })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/cross-origin frame/)
    expect(cdpCalls(contents, 'Input.dispatchKeyEvent')).toHaveLength(0)
  })

  it('still allows caret and dismissal keys in a frame it cannot inspect', async () => {
    const contents = await openPage()
    respondWith(contents, { activeElementSecrecy: 'opaque', readActiveElementState: {} })

    const result = await driver.executeTool('browser_press_key', { key: 'Escape' })

    expect(result.ok).toBe(true)
    expect(cdpCalls(contents, 'Input.dispatchKeyEvent').length).toBeGreaterThan(0)
  })

  it('sends the keystroke when nothing sensitive is focused', async () => {
    const contents = await openPage()
    respondWith(contents, { activeElementSecrecy: 'safe', readActiveElementState: {} })

    const result = await driver.executeTool('browser_press_key', { key: 'a' })

    expect(result.ok).toBe(true)
    expect(cdpCalls(contents, 'Input.dispatchKeyEvent').length).toBeGreaterThan(0)
  })

  it('aborts a type when focus moves to a password field before the insert', async () => {
    const contents = await openPage()
    // The element passed the guard, then the page advanced focus — what a
    // login form does between the username and password steps.
    respondWith(contents, {
      focusElementForTyping: { focused: true, kind: 'input' },
      activeElementSecrecy: 'secret',
    })

    const result = await driver.executeTool('browser_type', { elementId: 0, text: 'hunter2' })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Refusing to act on a password field/)
    expect(cdpCalls(contents, 'Input.insertText')).toHaveLength(0)
  })

  it('types normally when focus stays on the vetted element', async () => {
    const contents = await openPage()
    respondWith(contents, {
      focusElementForTyping: { focused: true, kind: 'input' },
      activeElementSecrecy: 'safe',
      readActiveElementState: { activeElement: 'input', valueLength: 7 },
    })

    const result = await driver.executeTool('browser_type', { elementId: 0, text: 'hunter2' })

    expect(result.ok).toBe(true)
    expect(cdpCalls(contents, 'Input.insertText')).toHaveLength(1)
  })

  it.each(['Cmd+V', 'Control+V', 'Cmd+C', 'Cmd+X'])(
    'refuses the clipboard shortcut %s',
    async (key) => {
      const contents = await openPage()
      respondWith(contents, { activeElementSecrecy: 'safe', readActiveElementState: {} })

      const result = await driver.executeTool('browser_press_key', { key })

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

    const result = await driver.executeTool('browser_press_key', { key: 'Cmd+A' })

    expect(result.ok).toBe(true)
  })

  it('surfaces the page-side refusal for element-targeted actions', async () => {
    const contents = await openPage()
    respondWith(contents, { clickElement: { error: 'password' } })

    const result = await driver.executeTool('browser_click', { elementId: 0 })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Refusing to act on a password field/)
  })
})
