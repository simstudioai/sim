import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { MAX_BROWSER_TABS } from '@sim/browser-protocol'
import { BrowserWindow } from 'electron'

type SessionModule = typeof import('@/main/browser-agent/session')

interface MockView {
  webContents: {
    session: {
      setPermissionRequestHandler: ReturnType<typeof vi.fn>
      setPermissionCheckHandler: ReturnType<typeof vi.fn>
    }
    on: ReturnType<typeof vi.fn>
    setWindowOpenHandler: ReturnType<typeof vi.fn>
    loadURL: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
    isFocused: ReturnType<typeof vi.fn>
    isDestroyed: ReturnType<typeof vi.fn>
    setBackgroundThrottling: ReturnType<typeof vi.fn>
    capturePage: ReturnType<typeof vi.fn>
  }
  setBackgroundColor: ReturnType<typeof vi.fn>
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

async function freshSession(
  win: BrowserWindow | null,
  eventOverrides: Partial<import('@/main/browser-agent/session').AgentSessionEvents> = {}
): Promise<SessionModule> {
  vi.resetModules()
  const session = await import('@/main/browser-agent/session')
  session.initSession(
    {
      onSessionClosed: vi.fn(),
      onTabCreated: vi.fn(),
      onActiveTabChanged: vi.fn(),
      onTabsChanged: vi.fn(),
      onTabThemeChanged: vi.fn(),
      onDownloadBlocked: vi.fn(),
      ...eventOverrides,
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

  it('normalizes browser shortcuts to Command on macOS and Control elsewhere', () => {
    const input = {
      type: 'keyDown',
      key: 'l',
      isAutoRepeat: false,
      isComposing: false,
      shift: false,
      control: false,
      alt: false,
      meta: true,
    }

    expect(session.browserShortcutForInput(input, 'darwin')).toBe('focus-omnibox')
    expect(session.browserShortcutForInput(input, 'win32')).toBeNull()
    expect(session.browserShortcutForInput({ ...input, meta: false, control: true }, 'win32')).toBe(
      'focus-omnibox'
    )
    expect(session.browserShortcutForInput({ ...input, key: 't' }, 'darwin')).toBe('new-tab')
    expect(session.browserShortcutForInput({ ...input, key: 'w' }, 'darwin')).toBe('close-tab')
    expect(
      session.browserShortcutForInput({ ...input, key: 't', shift: true }, 'darwin')
    ).toBeNull()
  })

  it('handles browser shortcuts from a focused native tab', () => {
    session.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    const first = session.requireTab()
    const firstContents = (first.view as unknown as MockView).webContents
    const beforeInput = firstContents.on.mock.calls.find(
      ([eventName]) => eventName === 'before-input-event'
    )?.[1] as
      | ((event: { preventDefault: () => void }, input: Record<string, unknown>) => void)
      | undefined
    const event = { preventDefault: vi.fn() }
    const input = {
      type: 'keyDown',
      key: 'l',
      isAutoRepeat: false,
      isComposing: false,
      shift: false,
      control: process.platform !== 'darwin',
      alt: false,
      meta: process.platform === 'darwin',
    }

    beforeInput?.(event, input)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(win.webContents.focus).toHaveBeenCalled()
    expect(win.webContents.send).toHaveBeenLastCalledWith('browser-agent:focus-omnibox', 'select')

    beforeInput?.(event, { ...input, key: 't' })
    expect(session.listTabs()).toHaveLength(2)
    expect(win.webContents.send).toHaveBeenLastCalledWith('browser-agent:focus-omnibox', 'clear')

    const second = session.activeTab()
    expect(second).not.toBeNull()
    const secondContents = (second?.view as unknown as MockView).webContents
    const secondBeforeInput = secondContents.on.mock.calls.find(
      ([eventName]) => eventName === 'before-input-event'
    )?.[1] as
      | ((event: { preventDefault: () => void }, input: Record<string, unknown>) => void)
      | undefined
    secondBeforeInput?.(event, { ...input, key: 'w' })
    expect(session.listTabs()).toHaveLength(1)
    expect(firstContents.focus).toHaveBeenCalled()

    beforeInput?.(event, { ...input, key: 'w' })
    expect(session.listTabs()).toHaveLength(1)
    expect(session.listTabs()[0].tabId).not.toBe(first.id)
    expect(win.webContents.send).toHaveBeenLastCalledWith('browser-agent:focus-omnibox', 'clear')
  })

  it('closes only the native browser tab targeted by the application menu accelerator', () => {
    session.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    const first = session.requireTab()
    const second = session.addTab()
    const firstContents = (first.view as unknown as MockView).webContents
    const secondContents = (second.view as unknown as MockView).webContents
    const focusListener = secondContents.on.mock.calls.find(
      ([eventName]) => eventName === 'focus'
    )?.[1] as (() => void) | undefined
    const blurListener = secondContents.on.mock.calls.find(
      ([eventName]) => eventName === 'blur'
    )?.[1] as (() => void) | undefined

    // Menu accelerators can shift Electron's live focus flag before their
    // click callback runs. The captured owner must survive that synchronous
    // blur and remain routable for the current event-loop turn.
    focusListener?.()
    blurListener?.()

    expect(session.closeFocusedTab()).toBe(true)
    expect(session.listTabs()).toHaveLength(1)
    expect(session.listTabs()[0].tabId).toBe(first.id)
    expect(firstContents.focus).toHaveBeenCalledOnce()

    // Focus ownership transfers with the close, so a repeated Mod+W closes
    // the newly active tab even if Electron has not emitted its focus event.
    expect(session.closeFocusedTab()).toBe(true)
    expect(session.listTabs()).toHaveLength(1)
    expect(session.listTabs()[0].tabId).not.toBe(first.id)

    // The replacement is an untouched about:blank tab. It still owns the
    // browser context, so it must not require a page load or another click.
    const blankTabId = session.listTabs()[0].tabId
    expect(session.closeFocusedTab()).toBe(true)
    expect(session.listTabs()).toHaveLength(1)
    expect(session.listTabs()[0].tabId).not.toBe(blankTabId)

    session.setPanelFocused(false)
    expect(session.closeFocusedTab()).toBe(false)
    expect(session.listTabs()).toHaveLength(1)
  })

  it('treats renderer browser chrome as browser focus', () => {
    session.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    const first = session.requireTab()
    const second = session.addTab()

    session.setPanelFocused(true)
    expect(session.closeFocusedTab()).toBe(true)
    expect(session.listTabs()).toHaveLength(1)
    expect(session.listTabs()[0].tabId).toBe(first.id)
    expect(session.listTabs()[0].tabId).not.toBe(second.id)

    session.setPanelFocused(false)
    expect(session.closeFocusedTab()).toBe(false)
  })

  it('retains browser focus while a renderer overlay temporarily occludes the page', () => {
    session.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    session.requireTab()
    session.setPanelFocused(true)

    // Tooltips and browser chrome overlays hide the native surface briefly;
    // visual occlusion is not a focus change.
    session.setPanelOccluded(true)
    expect(session.closeFocusedTab()).toBe(true)
  })

  it('only disables hidden-page throttling while browser automation is active', () => {
    const tab = session.ensureTab()
    const contents = (tab.view as unknown as MockView).webContents

    session.setAutomationActive(true)
    expect(contents.setBackgroundThrottling).toHaveBeenLastCalledWith(false)

    session.setAutomationActive(false)
    expect(contents.setBackgroundThrottling).toHaveBeenLastCalledWith(true)
  })

  it('updates the native backdrop when Sim changes browser theme', () => {
    const tab = session.ensureTab()
    const view = tab.view as unknown as MockView

    session.setBrowserTheme('dark')
    expect(session.getBrowserTheme()).toBe('dark')
    expect(view.setBackgroundColor).toHaveBeenLastCalledWith('#0c0c0c')

    session.setBrowserTheme('light')
    expect(view.setBackgroundColor).toHaveBeenLastCalledWith('#ffffff')
  })

  it('propagates theme changes to every existing tab', async () => {
    const onTabThemeChanged = vi.fn()
    const themedSession = await freshSession(win, { onTabThemeChanged })
    const first = themedSession.ensureTab()
    const second = themedSession.addTab()

    themedSession.setBrowserTheme('dark')

    expect(onTabThemeChanged.mock.calls).toEqual([
      [first.view.webContents, 'dark'],
      [second.view.webContents, 'dark'],
    ])
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

  it('limits the browser session to five open tabs', () => {
    session.ensureTab()
    for (let index = 1; index < MAX_BROWSER_TABS; index++) {
      session.addTab()
    }

    expect(session.listTabs()).toHaveLength(MAX_BROWSER_TABS)
    expect(() => session.addTab()).toThrow(
      `The browser supports up to ${MAX_BROWSER_TABS} open tabs.`
    )
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

  it('repositions the view synchronously on window resize via edge anchoring', () => {
    const tab = session.ensureTab()
    const view = tab.view as unknown as MockView
    const mock = win as unknown as {
      on: ReturnType<typeof vi.fn>
      removeListener: ReturnType<typeof vi.fn>
      getContentSize: ReturnType<typeof vi.fn>
    }

    // Renderer report at content size 1180x850 → anchor right=280, bottom=200.
    session.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    const resizeListener = mock.on.mock.calls.find(([event]) => event === 'resize')?.[1] as
      | (() => void)
      | undefined
    expect(resizeListener).toBeDefined()

    // Window grows before the renderer re-reports: the prediction stretches
    // the view with the right/bottom edges immediately.
    view.setBounds.mockClear()
    mock.getContentSize.mockReturnValue([1380, 950])
    resizeListener?.()
    expect(view.setBounds).toHaveBeenCalledWith({ x: 100, y: 50, width: 1000, height: 700 })

    // The renderer's authoritative report then lands without a redundant set
    // when it matches the prediction.
    view.setBounds.mockClear()
    session.setPanelBounds({ x: 100, y: 50, width: 1000, height: 700 })
    expect(view.setBounds).not.toHaveBeenCalled()

    // Hiding the panel removes the resize listener.
    session.setPanelBounds(null)
    expect(mock.removeListener).toHaveBeenCalledWith('resize', resizeListener)
  })

  it('creates one real default tab when the browser panel becomes visible', () => {
    expect(session.listTabs()).toHaveLength(0)

    session.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })

    expect(session.listTabs()).toHaveLength(1)
    expect(session.getTabsState().activeTabId).toBe(session.listTabs()[0].tabId)

    const firstTabId = session.listTabs()[0].tabId
    session.closeTab(firstTabId)
    expect(session.listTabs()).toHaveLength(1)
    expect(session.listTabs()[0].tabId).not.toBe(firstTabId)
  })

  it('clears a stale attachment without touching a destroyed host window', () => {
    const tab = session.ensureTab()
    session.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    const staleContent = (
      win as unknown as {
        contentView: {
          removeChildView: ReturnType<typeof vi.fn>
        }
      }
    ).contentView
    staleContent.removeChildView.mockClear()
    staleContent.removeChildView.mockImplementation(() => {
      throw new Error('Object has been destroyed')
    })
    vi.mocked(win.isDestroyed).mockReturnValue(true)

    const replacement = mainWindowMock()
    session.initSession(
      {
        onSessionClosed: vi.fn(),
        onTabCreated: vi.fn(),
        onActiveTabChanged: vi.fn(),
        onTabsChanged: vi.fn(),
        onTabThemeChanged: vi.fn(),
        onDownloadBlocked: vi.fn(),
      },
      () => replacement
    )

    expect(() => session.setPanelBounds(null)).not.toThrow()
    expect(staleContent.removeChildView).not.toHaveBeenCalled()

    session.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    const replacementContent = (
      replacement as unknown as {
        contentView: {
          addChildView: ReturnType<typeof vi.fn>
        }
      }
    ).contentView
    expect(replacementContent.addChildView).toHaveBeenCalledWith(tab.view)
  })

  it('clears a stale attachment without touching a destroyed child view', () => {
    const tab = session.ensureTab()
    const view = tab.view as unknown as MockView
    session.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    const content = (
      win as unknown as {
        contentView: {
          removeChildView: ReturnType<typeof vi.fn>
        }
      }
    ).contentView
    content.removeChildView.mockClear()
    view.webContents.isDestroyed.mockReturnValue(true)

    expect(() => session.setPanelBounds(null)).not.toThrow()
    expect(content.removeChildView).not.toHaveBeenCalled()
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

  it('keeps an occluded view attached, captures its frame, and toggles visibility', async () => {
    const tab = session.ensureTab()
    const view = tab.view as unknown as MockView
    const content = (
      win as unknown as {
        contentView: {
          addChildView: ReturnType<typeof vi.fn>
          removeChildView: ReturnType<typeof vi.fn>
        }
      }
    ).contentView
    session.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    content.removeChildView.mockClear()
    view.setVisible.mockClear()

    session.setPanelOccluded(true)

    expect(content.removeChildView).not.toHaveBeenCalled()
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    await vi.waitFor(() => {
      expect(win.webContents.send).toHaveBeenCalledWith('browser-agent:panel-snapshot', {
        dataUrl: 'data:image/png;base64,c2lt',
        tabId: tab.id,
      })
    })

    session.setPanelOccluded(false)
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
  })

  it('hardens every tab and keeps http popups inside a new internal tab', () => {
    const tab = session.ensureTab()
    const contents = (tab.view as unknown as MockView).webContents
    expect(contents.session.setPermissionRequestHandler).toHaveBeenCalled()
    expect(contents.session.setPermissionCheckHandler).toHaveBeenCalled()

    const openHandler = contents.setWindowOpenHandler.mock.calls[0][0] as (details: {
      url: string
    }) => { action: string }
    expect(openHandler({ url: 'https://example.com/popup' })).toEqual({ action: 'deny' })
    expect(session.listTabs()).toHaveLength(2)
    const popupContents = (session.activeTab()?.view as unknown as MockView | undefined)
      ?.webContents
    expect(popupContents?.loadURL).toHaveBeenCalledWith('https://example.com/popup')
    expect(contents.loadURL).not.toHaveBeenCalledWith('https://example.com/popup')
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
