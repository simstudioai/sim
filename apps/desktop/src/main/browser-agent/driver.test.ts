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
      vi.mocked(contents.executeJavaScript).mockImplementation(
        () => new Promise<never>(() => {})
      )

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
      vi.mocked(contents.executeJavaScript).mockImplementation(
        () => new Promise<never>(() => {})
      )

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
