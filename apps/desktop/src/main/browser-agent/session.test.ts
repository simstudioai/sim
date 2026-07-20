import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { BrowserWindow } from 'electron'

type SessionModule = typeof import('@/main/browser-agent/session')

interface MockView {
  webContents: {
    session: {
      setPermissionRequestHandler: ReturnType<typeof vi.fn>
      setPermissionCheckHandler: ReturnType<typeof vi.fn>
    }
    setWindowOpenHandler: ReturnType<typeof vi.fn>
    loadURL: ReturnType<typeof vi.fn>
    setBackgroundThrottling: ReturnType<typeof vi.fn>
  }
  setBounds: ReturnType<typeof vi.fn>
  setVisible: ReturnType<typeof vi.fn>
}

function mainWindowMock() {
  const win = new BrowserWindow() as unknown as {
    contentView: {
      addChildView: ReturnType<typeof vi.fn>
      removeChildView: ReturnType<typeof vi.fn>
    }
    webContents: { getZoomFactor?: ReturnType<typeof vi.fn> }
  }
  win.webContents.getZoomFactor = vi.fn(() => 1)
  return win as unknown as BrowserWindow
}

async function freshSession(win: BrowserWindow | null): Promise<SessionModule> {
  vi.resetModules()
  const session = await import('@/main/browser-agent/session')
  session.initSession(
    {
      onSessionClosed: vi.fn(),
      onTabCreated: vi.fn(),
      onActiveTabChanged: vi.fn(),
      onDownloadBlocked: vi.fn(),
    },
    () => win
  )
  return session
}

describe('browser-agent session', () => {
  let win: BrowserWindow
  let session: SessionModule

  beforeEach(async () => {
    win = mainWindowMock()
    session = await freshSession(win)
  })

  it('creates the first tab lazily, then reuses it', () => {
    expect(session.hasSession()).toBe(false)
    const first = session.ensureTab()
    expect(session.hasSession()).toBe(true)
    expect(session.ensureTab()).toBe(first)
    expect(session.listTabs()).toHaveLength(1)
    expect(session.listTabs()[0]).toMatchObject({ tabId: first.id, active: true })
  })

  it('only disables hidden-page throttling while browser automation is active', () => {
    const tab = session.ensureTab()
    const contents = (tab.view as unknown as MockView).webContents

    session.setAutomationActive(true)
    expect(contents.setBackgroundThrottling).toHaveBeenLastCalledWith(false)

    session.setAutomationActive(false)
    expect(contents.setBackgroundThrottling).toHaveBeenLastCalledWith(true)
  })

  it('requireTab refuses when no page is open yet', () => {
    expect(() => session.requireTab()).toThrow(/No page is open yet/)
  })

  it('opens, switches, and closes tabs with stable ids', () => {
    const first = session.ensureTab()
    const second = session.addTab()
    expect(second.id).not.toBe(first.id)
    expect(session.activeTab()?.id).toBe(second.id)

    const switched = session.switchTab(first.id)
    expect(switched.id).toBe(first.id)
    expect(session.activeTab()?.id).toBe(first.id)

    session.closeTab(first.id)
    expect(session.listTabs().map((tab) => tab.tabId)).toEqual([second.id])
    expect(session.activeTab()?.id).toBe(second.id)

    expect(() => session.switchTab('999')).toThrow(/No tab with id 999/)
    expect(() => session.closeTab('999')).toThrow(/No tab with id 999/)
  })

  it('embeds the active view in the MAIN window only while panel bounds are reported', () => {
    const tab = session.ensureTab()
    const view = tab.view as unknown as MockView
    const content = (win as unknown as { contentView: { addChildView: ReturnType<typeof vi.fn> } })
      .contentView

    // No bounds yet: the view is not attached to the window.
    expect(content.addChildView).not.toHaveBeenCalledWith(tab.view)

    session.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    expect(content.addChildView).toHaveBeenCalledWith(tab.view)
    expect(view.setBounds).toHaveBeenCalledWith({ x: 100, y: 50, width: 800, height: 600 })

    // Panel hidden: the view detaches.
    const removeChildView = (
      win as unknown as { contentView: { removeChildView: ReturnType<typeof vi.fn> } }
    ).contentView.removeChildView
    session.setPanelBounds(null)
    expect(removeChildView).toHaveBeenCalledWith(tab.view)
  })

  it('scales panel bounds by the main window zoom factor', () => {
    const winZoomed = mainWindowMock()
    ;(
      winZoomed as unknown as { webContents: { getZoomFactor: ReturnType<typeof vi.fn> } }
    ).webContents.getZoomFactor = vi.fn(() => 1.5)
    return freshSession(winZoomed).then((zoomedSession) => {
      const tab = zoomedSession.ensureTab()
      zoomedSession.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
      expect((tab.view as unknown as MockView).setBounds).toHaveBeenCalledWith({
        x: 150,
        y: 75,
        width: 1200,
        height: 900,
      })
    })
  })

  it('hardens every tab: agent partition default-denies permissions and popups collapse into the same view', () => {
    const tab = session.ensureTab()
    const contents = (tab.view as unknown as MockView).webContents
    expect(contents.session.setPermissionRequestHandler).toHaveBeenCalled()
    expect(contents.session.setPermissionCheckHandler).toHaveBeenCalled()

    const openHandler = contents.setWindowOpenHandler.mock.calls[0][0] as (details: {
      url: string
    }) => { action: string }
    expect(openHandler({ url: 'https://example.com/popup' })).toEqual({ action: 'deny' })
    expect(contents.loadURL).toHaveBeenCalledWith('https://example.com/popup')
    // Non-http(s) popups are denied without navigating anywhere.
    contents.loadURL.mockClear()
    expect(openHandler({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' })
    expect(contents.loadURL).not.toHaveBeenCalled()
  })

  it('permission handlers deny every request on the agent partition', () => {
    const tab = session.ensureTab()
    const ses = (tab.view as unknown as MockView).webContents.session
    const requestHandler = ses.setPermissionRequestHandler.mock.calls[0][0] as (
      wc: unknown,
      permission: string,
      callback: (granted: boolean) => void
    ) => void
    const callback = vi.fn()
    requestHandler(null, 'media', callback)
    expect(callback).toHaveBeenCalledWith(false)

    const checkHandler = ses.setPermissionCheckHandler.mock.calls[0][0] as () => boolean
    expect(checkHandler()).toBe(false)
  })
})
