import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { MAX_BROWSER_TABS } from '@sim/browser-protocol'
import { BrowserWindow, session as electronSession } from 'electron'

type SessionModule = typeof import('@/main/browser-agent/session')
type PanelModule = typeof import('@/main/browser-agent/panel')

/** Set by freshSession — compositing lives in its own module now. */
let panel: PanelModule

interface MockView {
  webContents: {
    session: {
      setPermissionRequestHandler: ReturnType<typeof vi.fn>
      setPermissionCheckHandler: ReturnType<typeof vi.fn>
    }
    on: ReturnType<typeof vi.fn>
    setWindowOpenHandler: ReturnType<typeof vi.fn>
    loadURL: ReturnType<typeof vi.fn>
    getURL: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
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
  eventOverrides: Partial<import('@/main/browser-agent/session').AgentSessionEvents> = {},
  persistence?: import('@/main/browser-agent/session').PinnedTabPersistence
): Promise<SessionModule> {
  vi.resetModules()
  const session = await import('@/main/browser-agent/session')
  panel = await import('@/main/browser-agent/panel')
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
    () => win,
    persistence
  )
  return session
}

/** The host `resize` listener panel.ts binds while a view is attached. */
function hostResizeHandler(win: BrowserWindow): () => void {
  const calls = (win as unknown as { on: ReturnType<typeof vi.fn> }).on.mock.calls
  const handler = calls.find(([event]) => event === 'resize')?.[1]
  if (typeof handler !== 'function') throw new Error('no host resize listener bound')
  return handler as () => void
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
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
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
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
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
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
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
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    session.requireTab()
    session.setPanelFocused(true)

    // Tooltips and browser chrome overlays hide the native surface briefly;
    // visual occlusion is not a focus change.
    panel.setPanelOccluded(true)
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

  it('selects the neighboring tab when the active tab closes', () => {
    const first = session.ensureTab()
    const second = session.addTab()
    const third = session.addTab()

    session.switchTab(second.id)
    session.closeTab(second.id)
    expect(session.activeTab()?.id).toBe(third.id)

    session.closeTab(third.id)
    expect(session.activeTab()?.id).toBe(first.id)
  })

  it('reopens the latest closed tab while the browser owns focus', () => {
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    session.ensureTab()
    const closed = session.addTab()
    session.setPanelFocused(true)
    session.closeTab(closed.id)

    expect(session.reopenFocusedTab()).toBe(true)
    const reopened = session.activeTab()
    expect(reopened?.id).not.toBe(closed.id)
    const contents = (reopened?.view as unknown as MockView | undefined)?.webContents
    expect(contents?.loadURL).toHaveBeenCalledWith('https://example.com/')
    expect(contents?.focus).toHaveBeenCalled()

    session.setPanelFocused(false)
    expect(session.reopenFocusedTab()).toBe(false)
  })

  it('keeps stale reports from another app window from hiding or controlling the browser panel', () => {
    const otherWindow = mainWindowMock()
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 }, win)
    session.ensureTab()
    vi.mocked(win.contentView.removeChildView).mockClear()

    panel.setPanelBounds(null, otherWindow)
    expect(win.contentView.removeChildView).not.toHaveBeenCalled()

    session.setPanelFocused(true, win)
    expect(session.closeFocusedTab(otherWindow)).toBe(false)
    expect(session.closeFocusedTab(win)).toBe(true)
  })

  it('reorders tabs while preserving the pinned-tab boundary', () => {
    const first = session.ensureTab()
    const second = session.addTab()
    const third = session.addTab()

    session.reorderTab(third.id, 0)
    expect(session.listTabs().map((tab) => tab.tabId)).toEqual([third.id, first.id, second.id])

    session.setTabPinned(first.id, true)
    session.reorderTab(second.id, 0)
    expect(session.listTabs().map((tab) => tab.tabId)).toEqual([first.id, second.id, third.id])

    session.reorderTab(first.id, 2)
    expect(session.listTabs().map((tab) => tab.tabId)).toEqual([first.id, second.id, third.id])
    expect(() => session.reorderTab('999', 0)).toThrow(/No tab with id 999/)
  })

  it('moves pinned tabs left and requires unpinning before any close path', async () => {
    const save = vi.fn()
    const pinnedSession = await freshSession(
      win,
      {},
      {
        load: () => [],
        save,
      }
    )
    const first = pinnedSession.ensureTab()
    const second = pinnedSession.addTab()

    pinnedSession.setTabPinned(second.id, true)

    expect(pinnedSession.listTabs()).toEqual([
      expect.objectContaining({ tabId: second.id, pinned: true }),
      expect.objectContaining({ tabId: first.id, pinned: false }),
    ])
    expect(save).toHaveBeenLastCalledWith(['https://example.com/'])
    expect(() => pinnedSession.closeTab(second.id)).toThrow(/Pinned tabs cannot be closed/)

    pinnedSession.setTabPinned(second.id, false)
    pinnedSession.closeTab(second.id)
    expect(pinnedSession.listTabs().map((tab) => tab.tabId)).toEqual([first.id])
    expect(save).toHaveBeenLastCalledWith([])
  })

  it('restores pinned tabs when the browser resource opens again', async () => {
    const restoredSession = await freshSession(
      win,
      {},
      {
        load: () => ['https://docs.sim.ai/guide'],
        save: vi.fn(),
      }
    )

    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })

    const [restored] = restoredSession.listTabs()
    expect(restored).toMatchObject({ pinned: true, active: true })
    const contents = (restoredSession.requireTab().view as unknown as MockView).webContents
    expect(contents.loadURL).toHaveBeenCalledWith('https://docs.sim.ai/guide')
    expect(() => restoredSession.closeTab(restored.tabId)).toThrow(/Pinned tabs cannot be closed/)

    const regular = restoredSession.addTab()
    expect(restoredSession.listTabs()).toEqual([
      expect.objectContaining({ tabId: restored.tabId, pinned: true }),
      expect.objectContaining({ tabId: regular.id, pinned: false, active: true }),
    ])
  })

  it('limits the browser session to the shared tab cap', () => {
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

    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    expect(content.addChildView).toHaveBeenCalledWith(tab.view)
    expect(view.setBounds).toHaveBeenCalledWith({ x: 100, y: 50, width: 800, height: 600 })

    // Panel hidden: the view stops painting but stays attached. Detaching
    // would give up its compositor surface, and rebuilding that on the way
    // back is the blank repaint that reads as the page having reloaded —
    // which is every switch to another resource and back.
    const removeChildView = (
      win as unknown as { contentView: { removeChildView: ReturnType<typeof vi.fn> } }
    ).contentView.removeChildView
    view.setVisible.mockClear()
    panel.setPanelBounds(null)
    expect(view.setVisible).toHaveBeenCalledWith(false)
    expect(removeChildView).not.toHaveBeenCalled()

    // Showing it again reuses the attached view rather than re-adding it.
    content.addChildView.mockClear()
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
    expect(content.addChildView).not.toHaveBeenCalled()
  })

  it('detaches the previous view when another tab becomes active', () => {
    const first = session.ensureTab()
    panel.setPanelBounds({ x: 0, y: 0, width: 800, height: 600 })
    const content = (
      win as unknown as {
        contentView: {
          addChildView: ReturnType<typeof vi.fn>
          removeChildView: ReturnType<typeof vi.fn>
        }
      }
    ).contentView
    content.addChildView.mockClear()
    content.removeChildView.mockClear()

    const second = session.addTab()

    // Hiding keeps a view attached, but a tab switch still has to detach:
    // two native views stacked in the window would composite over each other.
    expect(content.removeChildView).toHaveBeenCalledWith(first.view)
    expect(content.addChildView).toHaveBeenCalledWith(second.view)
  })

  // The measured report is the sole writer of bounds. A main-process
  // prediction on the window's own `resize` used to race it: it assumed a
  // constant panel width, which only holds after a divider drag pins one, so
  // with the default half-width panel it applied a rect that disagreed with
  // the measurement by half the window's travel — twice per frame, because
  // the two writers shared a dedup key and kept invalidating each other.
  it('applies renderer-measured bounds once and invents no rect when the window grows', () => {
    const tab = session.ensureTab()
    const view = tab.view as unknown as MockView
    const mock = win as unknown as {
      on: ReturnType<typeof vi.fn>
      getContentSize: ReturnType<typeof vi.fn>
    }

    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    expect(view.setBounds).toHaveBeenCalledWith({ x: 100, y: 50, width: 800, height: 600 })

    // The window's resize is a layout trigger, never a source of bounds. On a
    // grow the clamp is inert, so the rect is unchanged and nothing is applied
    // until the renderer measures — this is what keeps the reverted prediction
    // from creeping back in.
    const onResize = hostResizeHandler(win)

    view.setBounds.mockClear()
    mock.getContentSize.mockReturnValue([1380, 950])
    onResize()
    expect(view.setBounds).not.toHaveBeenCalled()

    // A repeated identical report stays idempotent.
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    expect(view.setBounds).not.toHaveBeenCalled()

    // The next measured rect is applied exactly once.
    panel.setPanelBounds({ x: 300, y: 50, width: 900, height: 700 })
    expect(view.setBounds).toHaveBeenCalledTimes(1)
    expect(view.setBounds).toHaveBeenCalledWith({ x: 300, y: 50, width: 900, height: 700 })
  })

  // A shrink outruns the renderer's measurement by a frame; without the clamp
  // the stale rect is applied verbatim and the view overhangs the new frame.
  it('confines the view to the content box when the window shrinks', () => {
    const tab = session.ensureTab()
    const view = tab.view as unknown as MockView
    const mock = win as unknown as {
      on: ReturnType<typeof vi.fn>
      getContentSize: ReturnType<typeof vi.fn>
    }

    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    const onResize = hostResizeHandler(win)

    view.setBounds.mockClear()
    mock.getContentSize.mockReturnValue([600, 400])
    onResize()

    expect(view.setBounds).toHaveBeenCalledTimes(1)
    expect(view.setBounds).toHaveBeenCalledWith({ x: 100, y: 50, width: 500, height: 350 })

    // Re-clamping the same stale rect is idempotent.
    onResize()
    expect(view.setBounds).toHaveBeenCalledTimes(1)
  })

  // The measured rect is a frame stale mid-drag, and for a half-width panel a
  // window change of D moves the panel's left edge by D/2 — which the clamp
  // cannot correct because it only truncates. The declared anchor is what moves
  // x, closing the gap between the divider and the view's left edge.
  it('re-derives the rect from the declared anchor while the window resizes', () => {
    const tab = session.ensureTab()
    const view = tab.view as unknown as MockView
    const mock = win as unknown as {
      on: ReturnType<typeof vi.fn>
      getContentSize: ReturnType<typeof vi.fn>
    }

    // Half-width panel, right-flush, measured at a 1000x800 viewport.
    mock.getContentSize.mockReturnValue([1000, 800])
    panel.setPanelBounds({ x: 500, y: 40, width: 500, height: 760 }, undefined, {
      viewportWidth: 1000,
      viewportHeight: 800,
      widthRatio: 0.5,
    })
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 500, y: 40, width: 500, height: 760 })

    const onResize = hostResizeHandler(win)

    // Window grows to 1200 wide: half-width means x moves to 600, not 500.
    view.setBounds.mockClear()
    mock.getContentSize.mockReturnValue([1200, 800])
    onResize()
    expect(view.setBounds).toHaveBeenCalledWith({ x: 600, y: 40, width: 600, height: 760 })

    // Shrinking below the measured size derives it just as well, with no help
    // from the clamp (600 wide → x 300, width 300, both inside the frame).
    view.setBounds.mockClear()
    mock.getContentSize.mockReturnValue([600, 800])
    onResize()
    expect(view.setBounds).toHaveBeenCalledWith({ x: 300, y: 40, width: 300, height: 760 })
  })

  it('prefers the measured rect over the anchor at the measured viewport', () => {
    const tab = session.ensureTab()
    const view = tab.view as unknown as MockView
    const mock = win as unknown as { getContentSize: ReturnType<typeof vi.fn> }

    // An anchor that disagrees with the measurement must not win while the
    // viewport still matches: measurement is authoritative, so a wrong anchor
    // can only ever affect the frames of a live resize.
    mock.getContentSize.mockReturnValue([1000, 800])
    panel.setPanelBounds({ x: 500, y: 40, width: 500, height: 760 }, undefined, {
      viewportWidth: 1000,
      viewportHeight: 800,
      widthRatio: 0,
    })

    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 500, y: 40, width: 500, height: 760 })
  })

  it('drops the resize listener while the panel is hidden', () => {
    session.ensureTab()
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    const onResize = hostResizeHandler(win)

    panel.setPanelBounds(null)

    expect(
      (win as unknown as { removeListener: ReturnType<typeof vi.fn> }).removeListener
    ).toHaveBeenCalledWith('resize', onResize)
  })

  it('creates one real default tab when the browser panel becomes visible', () => {
    expect(session.listTabs()).toHaveLength(0)

    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })

    expect(session.listTabs()).toHaveLength(1)
    expect(session.getTabsState().activeTabId).toBe(session.listTabs()[0].tabId)

    const firstTabId = session.listTabs()[0].tabId
    session.closeTab(firstTabId)
    expect(session.listTabs()).toHaveLength(1)
    expect(session.listTabs()[0].tabId).not.toBe(firstTabId)
  })

  it('clears a stale attachment without touching a destroyed host window', () => {
    const tab = session.ensureTab()
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
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

    expect(() => panel.setPanelBounds(null)).not.toThrow()
    expect(staleContent.removeChildView).not.toHaveBeenCalled()

    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
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
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    const content = (
      win as unknown as {
        contentView: {
          removeChildView: ReturnType<typeof vi.fn>
        }
      }
    ).contentView
    content.removeChildView.mockClear()
    view.webContents.isDestroyed.mockReturnValue(true)

    expect(() => panel.setPanelBounds(null)).not.toThrow()
    expect(content.removeChildView).not.toHaveBeenCalled()
  })

  it('scales panel bounds by the main window zoom factor', () => {
    const winZoomed = mainWindowMock()
    ;(
      winZoomed as unknown as { webContents: { getZoomFactor: ReturnType<typeof vi.fn> } }
    ).webContents.getZoomFactor = vi.fn(() => 1.5)
    // Roomy content box so the clamp stays inert and this covers zoom alone.
    ;(winZoomed as unknown as { getContentSize: ReturnType<typeof vi.fn> }).getContentSize = vi.fn(
      () => [2000, 1400]
    )
    return freshSession(winZoomed).then((zoomedSession) => {
      const tab = zoomedSession.ensureTab()
      panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
      expect((tab.view as unknown as MockView).setBounds).toHaveBeenCalledWith({
        x: 150,
        y: 75,
        width: 1200,
        height: 900,
      })
    })
  })

  it('keeps an occluded view attached, and hides it only once its frame is sent', async () => {
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
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    content.removeChildView.mockClear()
    view.setVisible.mockClear()

    panel.setPanelOccluded(true)

    expect(content.removeChildView).not.toHaveBeenCalled()
    // The page stays up until the frame that replaces it is sent: the renderer
    // paints its snapshot the moment it reports occlusion, and hiding first
    // leaves it showing the previous overlay's frame in the gap.
    expect(view.setVisible).not.toHaveBeenCalledWith(false)
    await vi.waitFor(() => {
      expect(win.webContents.send).toHaveBeenCalledWith('browser-agent:panel-snapshot', {
        dataUrl: 'data:image/png;base64,c2lt',
        tabId: tab.id,
      })
    })
    await vi.waitFor(() => expect(view.setVisible).toHaveBeenLastCalledWith(false))

    panel.setPanelOccluded(false)
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

  it('leaves nothing of the signed-out user behind in the browser profile', async () => {
    const clearStorageData = vi.fn(async () => {})
    const clearCache = vi.fn(async () => {})
    vi.mocked(electronSession.fromPartition).mockReturnValue({
      clearStorageData,
      clearCache,
    } as unknown as ReturnType<typeof electronSession.fromPartition>)
    const save = vi.fn()
    session = await freshSession(win, {}, { load: () => [], save })

    panel.setPanelBounds({ x: 0, y: 0, width: 800, height: 600 })
    const survivor = (session.ensureTab().view as unknown as MockView).webContents
    session.closeTab(session.addTab().id)
    expect(session.reopenClosedTab()).not.toBeNull()

    await session.clearProfileStorage()

    expect(survivor.close).toHaveBeenCalled()
    expect(session.listTabs()).toHaveLength(0)
    // Reopen Closed Tab must not resurrect the previous account's browsing.
    expect(session.reopenClosedTab()).toBeNull()
    expect(save).toHaveBeenLastCalledWith([])
    expect(clearStorageData).toHaveBeenCalled()
    expect(clearCache).toHaveBeenCalled()
  })

  it('does not rewrite the settings file when the pinned tabs have not changed', async () => {
    const save = vi.fn()
    session = await freshSession(win, {}, { load: () => [], save })
    const tab = session.ensureTab()
    const contents = (tab.view as unknown as MockView).webContents
    const onNavigate = contents.on.mock.calls.find(
      ([eventName]) => eventName === 'did-navigate-in-page'
    )?.[1] as () => void
    save.mockClear()

    // Any single-page app fires this on every route change, and the settings
    // store's `===` comparison never matches a freshly built array — so each
    // one used to mean a synchronous whole-file write on the main thread.
    onNavigate()
    onNavigate()
    onNavigate()

    expect(save).not.toHaveBeenCalled()
  })

  it('persists once when a tab actually becomes pinned', async () => {
    const save = vi.fn()
    session = await freshSession(win, {}, { load: () => [], save })
    const tab = session.ensureTab()
    ;(tab.view as unknown as MockView).webContents.getURL.mockReturnValue('https://example.com/')
    save.mockClear()

    session.setTabPinned(tab.id, true)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenLastCalledWith(['https://example.com/'])
  })

  it('drops a tab whose renderer crashed instead of wedging the session', () => {
    const first = session.ensureTab()
    const second = session.addTab()
    const crashed = (second.view as unknown as MockView).webContents
    const onGone = crashed.on.mock.calls.find(
      ([eventName]) => eventName === 'render-process-gone'
    )?.[1] as (event: unknown, details: { reason: string }) => void

    onGone({}, { reason: 'crashed' })

    // Left in place, activeTab() filters the dead view out while activeTabId
    // still names it, so requireTab() reports "no page is open" even though
    // another tab is right there.
    expect(session.listTabs().map((tab) => tab.tabId)).toEqual([first.id])
    expect(session.requireTab().id).toBe(first.id)
  })

  it('reports the session closed when the only tab crashes', async () => {
    const onSessionClosed = vi.fn()
    session = await freshSession(win, { onSessionClosed })
    const contents = (session.ensureTab().view as unknown as MockView).webContents
    const onGone = contents.on.mock.calls.find(
      ([eventName]) => eventName === 'render-process-gone'
    )?.[1] as (event: unknown, details: { reason: string }) => void

    onGone({}, { reason: 'oom' })

    expect(session.listTabs()).toHaveLength(0)
    expect(onSessionClosed).toHaveBeenCalled()
  })

  it('hides the panel when the renderer stops renewing its bounds lease', async () => {
    vi.useFakeTimers()
    try {
      session = await freshSession(win)
      session.ensureTab()
      panel.setPanelBounds({ x: 0, y: 0, width: 800, height: 600 }, win)
      const contentView = (
        win as unknown as { contentView: { removeChildView: ReturnType<typeof vi.fn> } }
      ).contentView
      contentView.removeChildView.mockClear()
      const view = session.requireTab().view as unknown as MockView
      view.setVisible.mockClear()

      // The renderer goes silent — crashed, unmounted, or wedged. Without the
      // lease the native view keeps floating over whatever replaced the panel.
      await vi.advanceTimersByTimeAsync(6_000)

      expect(view.setVisible).toHaveBeenCalledWith(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the panel while the renderer keeps renewing the lease', async () => {
    vi.useFakeTimers()
    try {
      session = await freshSession(win)
      session.ensureTab()
      const bounds = { x: 0, y: 0, width: 800, height: 600 }
      panel.setPanelBounds(bounds, win)
      const contentView = (
        win as unknown as { contentView: { removeChildView: ReturnType<typeof vi.fn> } }
      ).contentView
      contentView.removeChildView.mockClear()

      // The renderer heartbeats about once a second.
      for (let beat = 0; beat < 6; beat++) {
        await vi.advanceTimersByTimeAsync(1_000)
        panel.setPanelBounds(bounds, win)
      }

      expect(contentView.removeChildView).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('hardens every distinct session, not only the first one configured', () => {
    // Guards against tracking this with one process-wide flag: the second
    // session would then be left with no permission handlers, no SSRF request
    // filtering, and no download blocking — silently, and still passing types.
    const first = (session.ensureTab().view as unknown as MockView).webContents.session
    const second = (session.addTab().view as unknown as MockView).webContents.session
    expect(second).not.toBe(first)

    for (const ses of [first, second]) {
      expect(ses.setPermissionRequestHandler).toHaveBeenCalled()
      expect(ses.setPermissionCheckHandler).toHaveBeenCalled()
    }
  })
})

/**
 * The browser is one native surface shared by every app window, so exactly one
 * window may drive it at a time. These cover who is allowed to take it.
 */
describe('browser panel ownership', () => {
  const BOUNDS = { x: 0, y: 0, width: 800, height: 600 }
  let win: BrowserWindow
  let other: BrowserWindow
  let session: SessionModule

  beforeEach(async () => {
    win = mainWindowMock()
    other = mainWindowMock()
    session = await freshSession(win)
  })

  it('lets any window claim a panel nobody owns yet', () => {
    expect(panel.canReportPanelBounds(other, null)).toBe(true)
  })

  it('keeps the owner reporting while Sim sits in the background', () => {
    panel.setPanelBounds(BOUNDS, win)

    // Nothing is focused, but the owner has not changed.
    expect(panel.canReportPanelBounds(win, null)).toBe(true)
  })

  it('refuses a second window claiming the panel while nothing is focused', () => {
    panel.setPanelBounds(BOUNDS, win)

    // Both windows heartbeat their bounds every second. Allowing an unfocused
    // claim makes them alternate ownership, re-parenting the native view
    // between windows roughly once a second for as long as Sim is unfocused.
    expect(panel.canReportPanelBounds(other, null)).toBe(false)
  })

  it('transfers ownership to the window the user focused', () => {
    panel.setPanelBounds(BOUNDS, win)

    expect(panel.canReportPanelBounds(other, other)).toBe(true)
  })

  it('frees the panel once the owning window is gone', () => {
    panel.setPanelBounds(BOUNDS, win)
    vi.mocked(win.isDestroyed).mockReturnValue(true)

    expect(panel.canReportPanelBounds(other, null)).toBe(true)
  })

  it('releases the panel when the owning window closes', () => {
    panel.setPanelBounds(BOUNDS, win)
    const view = session.ensureTab().view as unknown as MockView
    view.setVisible.mockClear()

    // Electron destroys the window before emitting `closed`, so the release
    // arrives from an already-destroyed window and must still be honoured.
    vi.mocked(win.isDestroyed).mockReturnValue(true)
    panel.setPanelBounds(null, win)

    expect(panel.canReportPanelBounds(other, null)).toBe(true)
    // Left owned, the next layout would re-parent the browser onto another
    // window at the closed window's bounds.
    expect(view.setVisible).not.toHaveBeenCalledWith(true)
  })

  it('ignores a live non-owner trying to hide the panel', () => {
    panel.setPanelBounds(BOUNDS, win)

    panel.setPanelBounds(null, other)

    expect(panel.canReportPanelBounds(other, null)).toBe(false)
  })

  it('ignores panel updates from a window that does not own the panel', () => {
    panel.setPanelBounds(BOUNDS, win)
    const view = session.ensureTab().view as unknown as MockView
    view.webContents.capturePage.mockClear()

    panel.setPanelOccluded(true, other)

    expect(view.webContents.capturePage).not.toHaveBeenCalled()
  })

  it('accepts panel updates from a live window once the owner is destroyed', () => {
    panel.setPanelBounds(BOUNDS, win)
    const view = session.ensureTab().view as unknown as MockView
    vi.mocked(win.isDestroyed).mockReturnValue(true)
    view.webContents.capturePage.mockClear()

    panel.setPanelOccluded(true, other)

    // A stale owner must not keep rejecting the window actually on screen.
    expect(view.webContents.capturePage).toHaveBeenCalled()
  })

  it('withholds a captured frame from a window that lost ownership mid-capture', async () => {
    panel.setPanelBounds(BOUNDS, win)
    session.ensureTab()
    const send = vi.mocked(win.webContents.send)
    send.mockClear()

    panel.setPanelOccluded(true, win)
    panel.setPanelBounds(BOUNDS, other)
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The frame is a picture of the page; the window no longer showing the
    // browser has no business receiving it.
    expect(
      send.mock.calls.filter(([channel]) => channel === 'browser-agent:panel-snapshot')
    ).toEqual([])
  })

  it('delivers a captured frame to an owner that kept the panel', async () => {
    panel.setPanelBounds(BOUNDS, win)
    session.ensureTab()
    const send = vi.mocked(win.webContents.send)
    send.mockClear()

    panel.setPanelOccluded(true, win)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(
      send.mock.calls.filter(([channel]) => channel === 'browser-agent:panel-snapshot').length
    ).toBe(1)
  })
})

describe('reopening a closed tab', () => {
  let win: BrowserWindow
  let session: SessionModule

  beforeEach(async () => {
    win = mainWindowMock()
    session = await freshSession(win)
  })

  it('restores an ordinary closed tab', () => {
    session.ensureTab()
    const closing = session.addTab()
    ;(closing.view as unknown as MockView).webContents.getURL.mockReturnValue(
      'https://example.com/inbox'
    )
    session.closeTab(closing.id)

    const reopened = session.reopenClosedTab()

    expect((reopened?.view as unknown as MockView).webContents.loadURL).toHaveBeenCalledWith(
      'https://example.com/inbox'
    )
  })

  it('never revives a URL carrying embedded credentials', () => {
    session.ensureTab()
    const closing = session.addTab()
    ;(closing.view as unknown as MockView).webContents.getURL.mockReturnValue(
      'https://user:secret@example.com/inbox'
    )
    session.closeTab(closing.id)

    const reopened = session.reopenClosedTab()

    // Falls back to a blank tab rather than re-sending the credentials.
    expect((reopened?.view as unknown as MockView).webContents.loadURL).not.toHaveBeenCalled()
  })

  it('duplicates a tab by loading the same URL in a new one', () => {
    session.ensureTab()
    const source = session.addTab()
    ;(source.view as unknown as MockView).webContents.getURL.mockReturnValue(
      'https://example.com/inbox'
    )

    const copy = session.duplicateTab(source.id)

    expect(copy?.id).not.toBe(source.id)
    expect((copy?.view as unknown as MockView).webContents.loadURL).toHaveBeenCalledWith(
      'https://example.com/inbox'
    )
  })

  it('never copies a URL carrying embedded credentials into a duplicate', () => {
    session.ensureTab()
    const source = session.addTab()
    ;(source.view as unknown as MockView).webContents.getURL.mockReturnValue(
      'https://user:pass@example.com/'
    )

    const copy = session.duplicateTab(source.id)

    // Falls back to a blank tab rather than re-sending the credentials.
    expect((copy?.view as unknown as MockView).webContents.loadURL).not.toHaveBeenCalled()
  })

  it('returns null when duplicating a tab that is not open', () => {
    session.ensureTab()
    expect(session.duplicateTab('no-such-tab')).toBeNull()
  })

  it('drops a non-http scheme from the reopen list', () => {
    session.ensureTab()
    const closing = session.addTab()
    ;(closing.view as unknown as MockView).webContents.getURL.mockReturnValue('file:///etc/passwd')
    session.closeTab(closing.id)

    const reopened = session.reopenClosedTab()

    expect((reopened?.view as unknown as MockView).webContents.loadURL).not.toHaveBeenCalled()
  })
})
