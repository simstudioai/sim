import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MenuItemConstructorOptions, WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { BrowserWindow, session as electronSession, Menu, shell, systemPreferences } from 'electron'
import { BASE_ZOOM_FACTOR, steppedZoomFactor } from '@/main/browser-agent/context-menu'
import * as panel from '@/main/browser-agent/panel'
import * as sessionModule from '@/main/browser-agent/session'
import type { BrowserSessionSnapshot } from '@/main/desktop-chat-session-store'

type SessionModule = typeof import('@/main/browser-agent/session')

const realPlatform = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
}

interface MockView {
  webContents: {
    session: {
      setPermissionRequestHandler: ReturnType<typeof vi.fn>
      setPermissionCheckHandler: ReturnType<typeof vi.fn>
    }
    on: ReturnType<typeof vi.fn>
    setUserAgent: ReturnType<typeof vi.fn>
    setWindowOpenHandler: ReturnType<typeof vi.fn>
    loadURL: ReturnType<typeof vi.fn>
    reload: ReturnType<typeof vi.fn>
    forcefullyCrashRenderer: ReturnType<typeof vi.fn>
    getURL: ReturnType<typeof vi.fn>
    getTitle: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
    invalidate: ReturnType<typeof vi.fn>
    isFocused: ReturnType<typeof vi.fn>
    isDestroyed: ReturnType<typeof vi.fn>
    isLoading: ReturnType<typeof vi.fn>
    isLoadingMainFrame: ReturnType<typeof vi.fn>
    setBackgroundThrottling: ReturnType<typeof vi.fn>
    getZoomFactor: ReturnType<typeof vi.fn>
    setZoomFactor: ReturnType<typeof vi.fn>
    capturePage: ReturnType<typeof vi.fn>
    findInPage: ReturnType<typeof vi.fn>
    stopFindInPage: ReturnType<typeof vi.fn>
    navigationHistory: {
      canGoBack: ReturnType<typeof vi.fn>
      canGoForward: ReturnType<typeof vi.fn>
      getActiveIndex: ReturnType<typeof vi.fn>
      goBack: ReturnType<typeof vi.fn>
      goForward: ReturnType<typeof vi.fn>
    }
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

/**
 * `initSession` is a full reset of both this module's and the panel's
 * per-session state, so a clean session needs no module reload — which is what
 * lets this file use static imports instead of the `vi.resetModules()` the
 * root CLAUDE.md forbids.
 */
function freshSession(
  win: BrowserWindow | null | (() => BrowserWindow | null),
  eventOverrides: Partial<sessionModule.AgentSessionEvents> = {},
  browserPersistence?: sessionModule.BrowserSessionPersistence,
  downloadSettings?: sessionModule.BrowserDownloadSettings
): SessionModule {
  const mainWindowProvider = typeof win === 'function' ? win : () => win
  const session = sessionModule
  session.initSession(
    {
      onSessionClosed: vi.fn(),
      onTabCreated: vi.fn(),
      onActiveTabChanged: vi.fn(),
      onPageStateChanged: vi.fn(),
      onTabsChanged: vi.fn(),
      onTabThemeChanged: vi.fn(),
      onTabNavigated: vi.fn(),
      onTabClosed: vi.fn(),
      ...eventOverrides,
    },
    mainWindowProvider,
    browserPersistence,
    downloadSettings
  )
  session.activateBrowserScope('chat-test')
  return session
}

function memoryBrowserPersistence(initial: Record<string, BrowserSessionSnapshot> = {}) {
  const snapshots = new Map(
    Object.entries(initial).map(([scopeId, snapshot]) => [scopeId, structuredClone(snapshot)])
  )
  const persistence: sessionModule.BrowserSessionPersistence = {
    load: vi.fn((scopeId) => {
      const snapshot = snapshots.get(scopeId)
      return snapshot ? structuredClone(snapshot) : null
    }),
    save: vi.fn((scopeId, snapshot) => {
      snapshots.set(scopeId, structuredClone(snapshot))
      return true
    }),
    migrateScope: vi.fn((fromScopeId, toScopeId) => {
      const snapshot = snapshots.get(fromScopeId)
      if (snapshot && !snapshots.has(toScopeId)) {
        snapshots.set(toScopeId, snapshot)
      }
      snapshots.delete(fromScopeId)
      return true
    }),
    disposeScope: vi.fn((scopeId) => snapshots.delete(scopeId)),
  }
  return { persistence, snapshots }
}

/** The host `resize` listener panel.ts binds while a view is attached. */
function hostResizeHandler(win: BrowserWindow): () => void {
  const calls = (win as unknown as { on: ReturnType<typeof vi.fn> }).on.mock.calls
  const handler = calls.find(([event]) => event === 'resize')?.[1]
  if (typeof handler !== 'function') throw new Error('no host resize listener bound')
  return handler as () => void
}

function mainFrameNavigationStarted(
  contents: MockView['webContents'],
  isSameDocument = false
): void {
  const handler = contents.on.mock.calls
    .filter(([eventName]) => eventName === 'did-start-navigation')
    .at(-1)?.[1]
  if (typeof handler !== 'function') throw new Error('no navigation-start listener bound')
  handler({ isMainFrame: true, isSameDocument })
}

describe('browser-agent session', () => {
  let win: BrowserWindow
  let session: SessionModule

  beforeEach(async () => {
    win = mainWindowMock()
    session = freshSession(win)
  })

  it('creates the first tab lazily, then reuses it', () => {
    expect(session.hasSession()).toBe(false)
    const first = session.ensureTab()
    expect(session.hasSession()).toBe(true)
    expect(session.ensureTab()).toBe(first)
    expect(session.listTabs()).toHaveLength(1)
    expect(session.listTabs()[0]).toMatchObject({ tabId: first.id, active: true })
  })

  it('invalidates only top-frame starts and identifies same-document commits', () => {
    const onTabNavigated = vi.fn()
    session = freshSession(win, { onTabNavigated })
    const tab = session.ensureTab()
    const contents = (tab.view as unknown as MockView).webContents
    const started = contents.on.mock.calls
      .filter(([eventName]) => eventName === 'did-start-navigation')
      .at(-1)?.[1] as ((details: { isMainFrame: boolean }) => void) | undefined
    const inPage = contents.on.mock.calls
      .filter(([eventName]) => eventName === 'did-navigate-in-page')
      .at(-1)?.[1] as ((_event: unknown, url: string, isMainFrame: boolean) => void) | undefined

    started?.({ isMainFrame: false })
    expect(onTabNavigated).not.toHaveBeenCalled()
    started?.({ isMainFrame: true })
    expect(onTabNavigated).toHaveBeenCalledWith(contents, false)

    onTabNavigated.mockClear()
    inPage?.({}, 'https://frame.example/', false)
    expect(onTabNavigated).not.toHaveBeenCalled()
    inPage?.({}, 'https://example.com/#password', true)

    expect(started).toBeTypeOf('function')
    expect(inPage).toBeTypeOf('function')
    expect(onTabNavigated).toHaveBeenCalledWith(contents, true)
  })

  it('gives every tab a user agent with no Electron token in it', () => {
    const first = session.ensureTab()
    const second = session.addTab()

    for (const tab of [first, second]) {
      const contents = (tab.view as unknown as MockView).webContents
      const agent = contents.setUserAgent.mock.calls.at(-1)?.[0] as string | undefined
      expect(agent).toMatch(/^Mozilla\/5\.0 \(.+\) .*Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/)
      expect(agent).not.toMatch(/Electron|Sim\//)
    }
  })

  it('settles the tab spinner when only subresources are still loading', () => {
    const tab = session.ensureTab()
    const contents = (tab.view as unknown as MockView).webContents
    contents.isLoading.mockReturnValue(true)
    contents.isLoadingMainFrame.mockReturnValue(false)

    expect(session.listTabs()[0]).toMatchObject({ tabId: tab.id, loading: false })

    contents.isLoadingMainFrame.mockReturnValue(true)
    expect(session.listTabs()[0]).toMatchObject({ tabId: tab.id, loading: true })
  })

  it('starts a second session clean instead of inheriting the first', () => {
    // `initSession` names itself as the session boundary but used to set three
    // of its thirteen fields, so everything else leaked into the next session:
    // its tabs, its theme, its find, its tab-id counter. Nothing re-inits in
    // production today, which is exactly why the gap stayed invisible — and
    // why these tests had to reset the whole MODULE to get a clean one.
    const firstTab = session.ensureTab()
    session.setBrowserTheme('dark')
    expect(session.listTabs()).toHaveLength(1)

    const second = freshSession(win)

    expect(second.listTabs()).toHaveLength(0)
    expect(second.getBrowserTheme()).toBe('system')
    // Same id as the first session's first tab: the counter restarted, so a
    // stale id cannot address a tab that outlived the session it came from.
    expect(second.ensureTab().id).toBe(firstTab.id)
  })

  it('keeps tabs and overlapping tab ids isolated by chat scope', () => {
    session.withBrowserScope('chat-a', () => {
      session.ensureTab()
      session.addTab()
    })
    session.withBrowserScope('chat-b', () => {
      session.ensureTab()
    })

    expect(session.withBrowserScope('chat-a', () => session.getTabsState())).toMatchObject({
      scopeId: 'chat-a',
      activeTabId: '2',
      tabs: [{ tabId: '1' }, { tabId: '2' }],
    })
    expect(session.withBrowserScope('chat-b', () => session.getTabsState())).toMatchObject({
      scopeId: 'chat-b',
      activeTabId: '1',
      tabs: [{ tabId: '1' }],
    })
  })

  it('keeps late WebContents events bound to the chat that created the tab', () => {
    const first = session.withBrowserScope('chat-a', () => session.ensureTab())
    session.withBrowserScope('chat-b', () => session.ensureTab())
    session.activateBrowserScope('chat-b')

    const renderGone = (first.view as unknown as MockView).webContents.on.mock.calls.find(
      ([eventName]) => eventName === 'render-process-gone'
    )?.[1] as ((event: unknown, details: { reason: string }) => void) | undefined
    renderGone?.({}, { reason: 'crashed' })

    expect(session.withBrowserScope('chat-a', () => session.listTabs())).toEqual([
      expect.objectContaining({
        tabId: first.id,
        issue: expect.objectContaining({ kind: 'crashed', reason: 'crashed' }),
      }),
    ])
    expect(session.withBrowserScope('chat-b', () => session.listTabs())).toHaveLength(1)
  })

  it('does not route a late hidden-chat shortcut into the active chat chrome', () => {
    const first = session.withBrowserScope('chat-a', () => session.ensureTab())
    const beforeInput = (first.view as unknown as MockView).webContents.on.mock.calls.find(
      ([eventName]) => eventName === 'before-input-event'
    )?.[1] as
      | ((event: { preventDefault: () => void }, input: Record<string, unknown>) => void)
      | undefined
    session.withBrowserScope('chat-b', () => session.ensureTab())
    session.activateBrowserScope('chat-b')
    vi.mocked(win.webContents.send).mockClear()

    beforeInput?.(
      { preventDefault: vi.fn() },
      {
        type: 'keyDown',
        key: 'f',
        isAutoRepeat: false,
        isComposing: false,
        shift: false,
        control: process.platform !== 'darwin',
        alt: false,
        meta: process.platform === 'darwin',
      }
    )

    expect(win.webContents.send).not.toHaveBeenCalledWith(
      'browser-agent:open-find',
      expect.anything()
    )
  })

  it('migrates pending scope state and aliases callbacks to the durable chat id', () => {
    const tab = session.withBrowserScope('pending:workspace', () => session.ensureTab())
    session.activateBrowserScope('chat-real')

    expect(session.migrateBrowserScope('pending:workspace', 'chat-real')).toBe(true)
    expect(session.withBrowserScope('chat-real', () => session.activeTab())).toBe(tab)
    expect(session.withBrowserScope('pending:workspace', () => session.activeTab())).toBe(tab)

    session.withBrowserScope('occupied', () => session.ensureTab())
    expect(session.migrateBrowserScope('chat-real', 'occupied')).toBe(false)
  })

  it('preserves a persisted destination behind a lazy activation', () => {
    const existingSnapshot: BrowserSessionSnapshot = {
      v: 1,
      tabs: [{ url: 'https://existing.example/', pinned: false }],
      activeIndex: 0,
      downloads: [],
    }
    const { persistence, snapshots } = memoryBrowserPersistence({
      'chat-real': existingSnapshot,
    })
    session = freshSession(win, {}, persistence)
    session.withBrowserScope('pending:workspace', () => session.ensureTab())
    session.activateBrowserScope('chat-real')

    expect(session.migrateBrowserScope('pending:workspace', 'chat-real')).toBe(false)
    expect(snapshots.get('chat-real')).toEqual(existingSnapshot)
    expect(session.withBrowserScope('pending:workspace', () => session.hasSession())).toBe(true)
  })

  it('does not retag live tabs when persistence explicitly refuses migration', () => {
    const { persistence } = memoryBrowserPersistence()
    persistence.migrateScope = vi.fn(() => false)
    session = freshSession(win, {}, persistence)
    const pendingTab = session.withBrowserScope('pending:workspace', () => session.ensureTab())

    expect(session.migrateBrowserScope('pending:workspace', 'chat-real')).toBe(false)
    expect(session.withBrowserScope('pending:workspace', () => session.activeTab())).toBe(
      pendingTab
    )
    expect(session.withBrowserScope('chat-real', () => session.activeTab())).toBeNull()
    expect(pendingTab.scopeId).toBe('pending:workspace')
  })

  it('routes an exact page selection and live tab metadata to the owning chat', () => {
    const tab = session.withBrowserScope('pending:workspace', () => session.ensureTab())
    const contents = (tab.view as unknown as MockView).webContents
    contents.getURL.mockReturnValue('https://example.com/docs')
    contents.getTitle.mockReturnValue('Example docs')
    session.activateBrowserScope('pending:workspace')
    expect(session.migrateBrowserScope('pending:workspace', 'chat-real')).toBe(true)

    const onContextMenu = contents.on.mock.calls.find(
      ([eventName]) => eventName === 'context-menu'
    )?.[1] as ((event: unknown, params: unknown) => void) | undefined
    onContextMenu?.(
      {},
      {
        selectionText: '  selected\ntext  ',
        linkURL: '',
        isEditable: false,
        editFlags: { canPaste: false },
      }
    )
    const template = vi.mocked(Menu.buildFromTemplate).mock.calls.at(-1)?.[0] as
      | MenuItemConstructorOptions[]
      | undefined
    const addToChat = template?.find((entry) => entry.label === 'Add to chat')
    addToChat?.click?.({} as never, undefined as never, {} as never)

    expect(win.webContents.focus).toHaveBeenCalled()
    expect(win.webContents.send).toHaveBeenCalledWith('browser-agent:add-to-chat', {
      text: '  selected\ntext  ',
      tabId: tab.id,
      url: 'https://example.com/docs',
      title: 'Example docs',
      scopeId: 'chat-real',
    })

    vi.mocked(win.webContents.send).mockClear()
    contents.getURL.mockReturnValue('file:///Users/example/private.txt')
    contents.getTitle.mockReturnValue('')
    onContextMenu?.(
      {},
      {
        selectionText: 'private',
        linkURL: '',
        isEditable: false,
        editFlags: { canPaste: false },
      }
    )
    const privateTemplate = vi.mocked(Menu.buildFromTemplate).mock.calls.at(-1)?.[0] as
      | MenuItemConstructorOptions[]
      | undefined
    privateTemplate
      ?.find((entry) => entry.label === 'Add to chat')
      ?.click?.({} as never, undefined as never, {} as never)
    expect(win.webContents.send).toHaveBeenCalledWith('browser-agent:add-to-chat', {
      text: 'private',
      tabId: tab.id,
      scopeId: 'chat-real',
    })
  })

  it('restores the complete per-chat tab strip after a restart', () => {
    const { persistence } = memoryBrowserPersistence()
    session = freshSession(win, {}, persistence)

    const first = session.withBrowserScope('chat-a', () => session.ensureTab())
    vi.mocked((first.view as unknown as MockView).webContents.getURL).mockReturnValue(
      'https://one.example/'
    )
    const second = session.withBrowserScope('chat-a', () => session.addTab())
    vi.mocked((second.view as unknown as MockView).webContents.getURL).mockReturnValue(
      'https://two.example/'
    )
    session.withBrowserScope('chat-a', () => {
      session.setTabPinned(first.id, true)
      session.switchTab(second.id)
    })

    session = freshSession(win, {}, persistence)
    vi.mocked(persistence.load).mockClear()
    session.activateBrowserScope('chat-a')
    expect(session.withBrowserScope('chat-a', () => session.peekTabsState())).toMatchObject({
      tabs: [],
      activeTabId: null,
    })
    expect(persistence.load).not.toHaveBeenCalled()

    const restored = session.withBrowserScope('chat-a', () => {
      session.restoreBrowserSession()
      return session.getTabsState()
    })
    expect(restored).toMatchObject({
      scopeId: 'chat-a',
      activeTabId: '2',
      tabs: [
        { tabId: '1', url: 'https://one.example/', pinned: true, active: false },
        { tabId: '2', url: 'https://two.example/', pinned: false, active: true },
      ],
    })
    expect(session.withBrowserScope('chat-a', () => session.activeTab()?.view)).not.toBe(
      second.view
    )
  })

  it('restores more than eight persisted tabs', () => {
    const tabs = Array.from({ length: 12 }, (_, index) => ({
      url: `https://tab-${index}.example/`,
      pinned: index < 2,
    }))
    const { persistence } = memoryBrowserPersistence({
      'chat-many-tabs': {
        v: 1,
        tabs,
        activeIndex: tabs.length - 1,
        downloads: [],
      },
    })
    session = freshSession(win, {}, persistence)

    const restored = session.withBrowserScope('chat-many-tabs', () => {
      session.restoreBrowserSession()
      return session.getTabsState()
    })

    expect(restored.tabs).toHaveLength(12)
    expect(restored.activeTabId).toBe('12')
    expect(restored.tabs.at(-1)).toMatchObject({
      url: 'https://tab-11.example/',
      active: true,
    })
  })

  it('bounds restored tabs while retaining pinned tabs and the active page', () => {
    const tabs = Array.from({ length: 40 }, (_, index) => ({
      url: `https://tab-${index}.example/`,
      pinned: index < 5,
    }))
    const { persistence } = memoryBrowserPersistence({
      'chat-bounded-tabs': {
        v: 1,
        tabs,
        activeIndex: tabs.length - 1,
        downloads: [],
      },
    })
    session = freshSession(win, {}, persistence)

    const restored = session.withBrowserScope('chat-bounded-tabs', () => {
      session.restoreBrowserSession()
      return session.getTabsState()
    })

    expect(restored.tabs).toHaveLength(32)
    expect(restored.tabs.filter((tab) => tab.pinned)).toHaveLength(5)
    expect(restored.tabs.find((tab) => tab.active)?.url).toBe('https://tab-39.example/')
  })

  it('refuses to materialize more than the per-task live tab budget', () => {
    session.ensureTab()
    for (let index = 1; index < 32; index++) session.addTab()

    expect(() => session.addTab()).toThrow('at most 32 open tabs')
    expect(session.getTabsState().tabs).toHaveLength(32)
  })

  it('bounds the total number of live browser WebContents across tasks', () => {
    for (let scopeIndex = 0; scopeIndex < 3; scopeIndex++) {
      session.withBrowserScope(`chat-cap-${scopeIndex}`, () => {
        session.ensureTab()
        for (let tabIndex = 1; tabIndex < 32; tabIndex++) session.addTab()
      })
    }

    expect(() => session.withBrowserScope('chat-cap-overflow', () => session.ensureTab())).toThrow(
      'at most 96 live browser tabs'
    )
  })

  it('does not truncate a saved browser session while the global tab budget is occupied', () => {
    const savedTabs = [
      { url: 'https://saved-one.example/', pinned: false },
      { url: 'https://saved-two.example/', pinned: false },
    ]
    const { persistence, snapshots } = memoryBrowserPersistence({
      'chat-pending-restore': {
        v: 1,
        tabs: savedTabs,
        activeIndex: 1,
        downloads: [],
      },
    })
    session = freshSession(win, {}, persistence)
    for (let scopeIndex = 0; scopeIndex < 3; scopeIndex++) {
      session.withBrowserScope(`chat-cap-${scopeIndex}`, () => {
        session.ensureTab()
        for (let tabIndex = 1; tabIndex < 32; tabIndex++) session.addTab()
      })
    }

    expect(() =>
      session.withBrowserScope('chat-pending-restore', () => session.restoreBrowserSession())
    ).toThrow('at most 96 live browser tabs')
    expect(snapshots.get('chat-pending-restore')?.tabs).toEqual(savedTabs)

    session.withBrowserScope('chat-cap-0', () => {
      const [first, second] = session.getTabsState().tabs
      session.closeTab(first.tabId)
      session.closeTab(second.tabId)
    })
    const restored = session.withBrowserScope('chat-pending-restore', () => {
      session.restoreBrowserSession()
      return session.getTabsState()
    })

    expect(restored.tabs.map(({ url }) => url)).toEqual(savedTabs.map(({ url }) => url))
    expect(restored.tabs.find((tab) => tab.active)?.url).toBe('https://saved-two.example/')
  })

  it('rolls back a failed restore and retries without duplicating tabs', () => {
    const { persistence } = memoryBrowserPersistence({
      'chat-retry': {
        v: 1,
        tabs: [
          { url: 'https://one.example/', pinned: false },
          { url: 'https://two.example/', pinned: true },
          { url: 'https://three.example/', pinned: false },
        ],
        activeIndex: 2,
        downloads: [],
      },
    })
    const createdContents: MockView['webContents'][] = []
    const onTabCreated = vi.fn((contents: WebContents) => {
      createdContents.push(contents as unknown as MockView['webContents'])
      if (createdContents.length === 2) throw new Error('instrumentation failed')
    })
    session = freshSession(win, { onTabCreated }, persistence)

    expect(() =>
      session.withBrowserScope('chat-retry', () => session.restoreBrowserSession())
    ).toThrow('instrumentation failed')
    expect(session.withBrowserScope('chat-retry', () => session.peekTabsState().tabs)).toEqual([])
    expect(createdContents).toHaveLength(2)
    expect(createdContents.every((contents) => contents.close.mock.calls.length === 1)).toBe(true)

    session.withBrowserScope('chat-retry', () => session.restoreBrowserSession())
    expect(session.withBrowserScope('chat-retry', () => session.getTabsState())).toMatchObject({
      activeTabId: '3',
      tabs: [
        { tabId: '2', url: 'https://two.example/', pinned: true, active: false },
        { tabId: '1', url: 'https://one.example/', pinned: false, active: false },
        { tabId: '3', url: 'https://three.example/', pinned: false, active: true },
      ],
    })

    session.withBrowserScope('chat-retry', () => session.restoreBrowserSession())
    expect(createdContents).toHaveLength(5)
  })

  it('quiesces live scopes without publishing session closure', () => {
    const onTabsChanged = vi.fn()
    const onSessionClosed = vi.fn()
    const lazySnapshot: BrowserSessionSnapshot = {
      v: 1,
      tabs: [{ url: 'https://lazy.example/', pinned: false }],
      activeIndex: 0,
      downloads: [],
    }
    const { persistence, snapshots } = memoryBrowserPersistence({
      'chat-lazy': lazySnapshot,
    })
    session = freshSession(win, { onTabsChanged, onSessionClosed }, persistence)
    session.activateBrowserScope('chat-lazy')
    const chatATab = session.withBrowserScope('chat-a', () => session.ensureTab())
    const chatBTab = session.withBrowserScope('chat-b', () => session.ensureTab())
    vi.mocked((chatATab.view as unknown as MockView).webContents.getURL).mockReturnValue(
      'https://a.example/'
    )
    vi.mocked((chatBTab.view as unknown as MockView).webContents.getURL).mockReturnValue(
      'https://b.example/'
    )
    onTabsChanged.mockClear()
    onSessionClosed.mockClear()

    session.quiesceBrowserSessions()
    session.quiesceBrowserSessions()

    expect(snapshots.get('chat-lazy')).toEqual(lazySnapshot)
    expect(snapshots.get('chat-a')).toMatchObject({
      tabs: [{ url: 'https://a.example/' }],
    })
    expect(snapshots.get('chat-b')).toMatchObject({
      tabs: [{ url: 'https://b.example/' }],
    })
    expect((chatATab.view as unknown as MockView).webContents.close).toHaveBeenCalledOnce()
    expect((chatBTab.view as unknown as MockView).webContents.close).toHaveBeenCalledOnce()
    expect(onTabsChanged).not.toHaveBeenCalled()
    expect(onSessionClosed).not.toHaveBeenCalled()
  })

  it('migrates a persisted pending snapshot without hydrating either scope', () => {
    const snapshot: BrowserSessionSnapshot = {
      v: 1,
      tabs: [{ url: 'https://pending.example/', pinned: false }],
      activeIndex: 0,
      downloads: [],
    }
    const { persistence, snapshots } = memoryBrowserPersistence({
      'pending:workspace': snapshot,
    })
    session = freshSession(win, {}, persistence)
    session.activateBrowserScope('pending:workspace')

    expect(session.migrateBrowserScope('pending:workspace', 'chat-real')).toBe(true)
    expect(persistence.load).not.toHaveBeenCalled()
    expect(persistence.migrateScope).toHaveBeenCalledWith('pending:workspace', 'chat-real')
    expect(snapshots.has('pending:workspace')).toBe(false)
    expect(snapshots.get('chat-real')).toEqual(snapshot)

    const restored = session.withBrowserScope('chat-real', () => {
      session.restoreBrowserSession()
      return session.getTabsState()
    })
    expect(restored.tabs).toMatchObject([{ url: 'https://pending.example/' }])
  })

  it('disposes an abandoned browser scope and its persisted descriptor', () => {
    const { persistence, snapshots } = memoryBrowserPersistence()
    session = freshSession(win, {}, persistence)
    const tab = session.withBrowserScope('pending:abandoned', () => session.ensureTab())
    expect(snapshots.has('pending:abandoned')).toBe(true)

    session.disposeBrowserScope('pending:abandoned')

    expect((tab.view as unknown as MockView).webContents.close).toHaveBeenCalled()
    expect(persistence.disposeScope).toHaveBeenCalledWith('pending:abandoned')
    expect(snapshots.has('pending:abandoned')).toBe(false)
    expect(
      session.withBrowserScope('pending:abandoned', () => session.peekTabsState())
    ).toMatchObject({
      tabs: [],
      activeTabId: null,
    })
  })

  it('suspends live pages while retaining a descriptor for a fresh lazy restore', () => {
    const onTabsChanged = vi.fn()
    const onSessionClosed = vi.fn()
    const { persistence, snapshots } = memoryBrowserPersistence()
    session = freshSession(win, { onTabsChanged, onSessionClosed }, persistence)
    const tab = session.withBrowserScope('chat-deleted', () => session.ensureTab())
    vi.mocked((tab.view as unknown as MockView).webContents.getURL).mockReturnValue(
      'https://retained.example/'
    )
    onTabsChanged.mockClear()
    onSessionClosed.mockClear()

    expect(session.suspendBrowserScope('chat-deleted')).toBe(true)

    expect((tab.view as unknown as MockView).webContents.close).toHaveBeenCalledOnce()
    expect(persistence.disposeScope).not.toHaveBeenCalled()
    expect(snapshots.get('chat-deleted')).toEqual({
      v: 1,
      tabs: [{ url: 'https://retained.example/', pinned: false }],
      activeIndex: 0,
      downloads: [],
    })
    expect(onTabsChanged).not.toHaveBeenCalled()
    expect(onSessionClosed).not.toHaveBeenCalled()

    expect(() =>
      session.withBrowserScope('chat-deleted', () => session.restoreBrowserSession())
    ).toThrow(/suspended/)

    session.activateBrowserScope('chat-deleted')
    const restoredTab = session.withBrowserScope('chat-deleted', () => {
      session.restoreBrowserSession()
      return session.activeTab()
    })
    expect(restoredTab).not.toBe(tab)
    expect(restoredTab?.pendingRestoreUrl).toBe('https://retained.example/')
  })

  it('closes live pages even when the suspend descriptor cannot be saved', () => {
    const { persistence } = memoryBrowserPersistence()
    vi.mocked(persistence.save).mockReturnValue(false)
    session = freshSession(win, {}, persistence)
    const tab = session.withBrowserScope('chat-deleted', () => session.ensureTab())

    // Suspension accompanies chat deletion: a failed descriptor save must
    // never leave the deleted chat's pages loaded invisibly.
    expect(session.suspendBrowserScope('chat-deleted')).toBe(true)

    expect((tab.view as unknown as MockView).webContents.close).toHaveBeenCalledOnce()
    expect(session.withBrowserScope('chat-deleted', () => session.peekTabsState())).toMatchObject({
      tabs: [],
      activeTabId: null,
    })
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
    expect(session.browserShortcutForInput({ ...input, key: 'f' }, 'darwin')).toBe('find')
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
    expect(win.webContents.send).toHaveBeenLastCalledWith(
      'browser-agent:focus-omnibox',
      'select',
      'chat-test'
    )

    beforeInput?.(event, { ...input, key: 't' })
    expect(session.listTabs()).toHaveLength(2)
    expect(win.webContents.send).toHaveBeenLastCalledWith(
      'browser-agent:focus-omnibox',
      'clear',
      'chat-test'
    )

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
    expect(win.webContents.send).toHaveBeenLastCalledWith(
      'browser-agent:focus-omnibox',
      'clear',
      'chat-test'
    )
  })

  it('opens the renderer find bar when the page takes Mod+F', () => {
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    const tab = session.requireTab()
    const contents = (tab.view as unknown as MockView).webContents
    const beforeInput = contents.on.mock.calls.find(
      ([eventName]) => eventName === 'before-input-event'
    )?.[1] as
      | ((event: { preventDefault: () => void }, input: Record<string, unknown>) => void)
      | undefined
    const event = { preventDefault: vi.fn() }

    beforeInput?.(event, {
      type: 'keyDown',
      key: 'f',
      isAutoRepeat: false,
      isComposing: false,
      shift: false,
      control: process.platform !== 'darwin',
      alt: false,
      meta: process.platform === 'darwin',
    })

    // The page never sees it — otherwise a site's own Mod+F wins over find.
    expect(event.preventDefault).toHaveBeenCalled()
    expect(win.webContents.send).toHaveBeenLastCalledWith('browser-agent:open-find', 'chat-test')
  })

  it('restarts the search while typing and steps without restarting on next/previous', () => {
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    const tab = session.requireTab()
    const contents = (tab.view as unknown as MockView).webContents

    session.findInActiveTab({ query: 'needle', newSession: true, forward: true })
    expect(contents.findInPage).toHaveBeenLastCalledWith('needle', {
      forward: true,
      findNext: true,
    })

    session.findInActiveTab({ query: 'needle', newSession: false, forward: false })
    expect(contents.findInPage).toHaveBeenLastCalledWith('needle', {
      forward: false,
      findNext: false,
    })

    // Clearing the box is a stop, not a search for the empty string — and the
    // bar has to survive it, or deleting the last character closes the bar the
    // user is still typing in.
    vi.mocked(win.webContents.send).mockClear()
    session.findInActiveTab({ query: '', newSession: true, forward: true })
    expect(contents.stopFindInPage).toHaveBeenCalledWith('clearSelection')
    expect(contents.findInPage).toHaveBeenCalledTimes(2)
    expect(win.webContents.send).not.toHaveBeenCalledWith('browser-agent:close-find')
  })

  it('forwards match counts only for the tab the find is running on', () => {
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    const first = session.requireTab()
    const second = session.addTab()
    const firstContents = (first.view as unknown as MockView).webContents
    const secondContents = (second.view as unknown as MockView).webContents
    const foundOn = (contents: MockView['webContents']) =>
      contents.on.mock.calls.find(([eventName]) => eventName === 'found-in-page')?.[1] as
        | ((event: unknown, result: Record<string, unknown>) => void)
        | undefined

    session.switchTab(first.id)
    session.findInActiveTab({ query: 'needle', newSession: true, forward: true })
    foundOn(firstContents)?.(
      {},
      { requestId: 1, activeMatchOrdinal: 2, matches: 7, finalUpdate: true }
    )
    expect(win.webContents.send).toHaveBeenLastCalledWith(
      'browser-agent:find-result',
      {
        activeMatchOrdinal: 2,
        matches: 7,
        final: true,
      },
      'chat-test'
    )

    // A late result from a tab that is not being searched would relabel the bar
    // with counts for a page the user is not looking at.
    vi.mocked(win.webContents.send).mockClear()
    foundOn(secondContents)?.(
      {},
      { requestId: 1, activeMatchOrdinal: 1, matches: 3, finalUpdate: true }
    )
    expect(win.webContents.send).not.toHaveBeenCalled()
  })

  it('drops late match counts from an older request on the active tab', () => {
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    const tab = session.requireTab()
    const contents = (tab.view as unknown as MockView).webContents
    const found = contents.on.mock.calls.find(
      ([eventName]) => eventName === 'found-in-page'
    )?.[1] as ((event: unknown, result: Record<string, unknown>) => void) | undefined
    contents.findInPage.mockReturnValueOnce(41).mockReturnValueOnce(42)

    session.findInActiveTab({ query: 'needle', newSession: true, forward: true })
    session.findInActiveTab({ query: 'needle', newSession: false, forward: true })
    vi.mocked(win.webContents.send).mockClear()

    found?.({}, { requestId: 41, activeMatchOrdinal: 1, matches: 12, finalUpdate: true })
    expect(win.webContents.send).not.toHaveBeenCalled()

    found?.({}, { requestId: 42, activeMatchOrdinal: 2, matches: 7, finalUpdate: true })
    expect(win.webContents.send).toHaveBeenLastCalledWith(
      'browser-agent:find-result',
      { activeMatchOrdinal: 2, matches: 7, final: true },
      'chat-test'
    )
  })

  it('drops the find when its page navigates away, but not on a same-document change', () => {
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    const tab = session.requireTab()
    const contents = (tab.view as unknown as MockView).webContents
    const navigate = contents.on.mock.calls.find(
      ([eventName]) => eventName === 'did-start-navigation'
    )?.[1] as ((details: Record<string, unknown>) => void) | undefined

    session.findInActiveTab({ query: 'needle', newSession: true, forward: true })
    vi.mocked(win.webContents.send).mockClear()

    // A pushState route change keeps the document the matches live in.
    navigate?.({ isMainFrame: true, isSameDocument: true })
    expect(win.webContents.send).not.toHaveBeenCalledWith('browser-agent:close-find')
    // A subframe load likewise leaves the main document alone.
    navigate?.({ isMainFrame: false, isSameDocument: false })
    expect(win.webContents.send).not.toHaveBeenCalledWith('browser-agent:close-find')

    navigate?.({ isMainFrame: true, isSameDocument: false })
    expect(contents.stopFindInPage).toHaveBeenCalledWith('clearSelection')
    expect(win.webContents.send).toHaveBeenCalledWith('browser-agent:close-find', 'chat-test')
  })

  it('drops the find when the tab it is running on is closed', () => {
    // Otherwise the searched tab id outlives the tab: the bar stays open
    // counting matches on a page that no longer exists, and nothing clears it
    // until the user happens to type a new query.
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    session.requireTab()
    const second = session.addTab()
    session.switchTab(second.id)
    session.findInActiveTab({ query: 'needle', newSession: true, forward: true })
    vi.mocked(win.webContents.send).mockClear()

    session.closeTab(second.id)

    expect(win.webContents.send).toHaveBeenCalledWith('browser-agent:close-find', 'chat-test')
  })

  it('drops the find when the tab it is running on crashes', () => {
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    const first = session.requireTab()
    session.addTab()
    session.switchTab(first.id)
    session.findInActiveTab({ query: 'needle', newSession: true, forward: true })
    vi.mocked(win.webContents.send).mockClear()

    const contents = (first.view as unknown as MockView).webContents
    const gone = contents.on.mock.calls.find(
      ([eventName]) => eventName === 'render-process-gone'
    )?.[1] as ((event: unknown, details: { reason: string }) => void) | undefined
    gone?.({}, { reason: 'crashed' })

    expect(win.webContents.send).toHaveBeenCalledWith('browser-agent:close-find', 'chat-test')
  })

  it('treats a failed navigation as a synthetic Back and Forward history entry', async () => {
    const mockContents = (session.ensureTab().view as unknown as MockView).webContents
    const contents = mockContents as unknown as WebContents
    mockContents.getURL.mockReturnValue('https://example.com/committed')
    mockContents.navigationHistory.getActiveIndex.mockReturnValue(3)
    session.recordPageLoadFailure(contents, {
      kind: 'load-error',
      code: -102,
      description: 'ERR_CONNECTION_REFUSED',
      url: 'https://example.com/failed',
    })

    expect(session.canGoBack(contents)).toBe(true)
    expect(session.listTabs()[0]).toMatchObject({
      url: 'https://example.com/failed',
      issue: { kind: 'load-error' },
    })

    expect(session.goBack(contents)).toBe(true)
    expect(session.listTabs()[0]).toMatchObject({ url: 'https://example.com/committed' })
    expect(session.listTabs()[0]).not.toHaveProperty('issue')
    expect(session.canGoForward(contents)).toBe(true)

    mockContents.navigationHistory.getActiveIndex.mockReturnValue(2)
    mockContents.navigationHistory.canGoForward.mockReturnValue(true)
    expect(session.goForward(contents)).toBe(true)
    expect(mockContents.navigationHistory.goForward).toHaveBeenCalledTimes(1)
    mainFrameNavigationStarted(mockContents)

    mockContents.navigationHistory.getActiveIndex.mockReturnValue(3)
    expect(session.goForward(contents)).toBe(true)
    expect(mockContents.loadURL).toHaveBeenCalledWith('https://example.com/failed')
  })

  it('discards a dismissed failed navigation when a fresh navigation starts', () => {
    const mockContents = (session.ensureTab().view as unknown as MockView).webContents
    const contents = mockContents as unknown as WebContents
    session.recordPageLoadFailure(contents, {
      kind: 'load-error',
      code: -105,
      description: 'ERR_NAME_NOT_RESOLVED',
      url: 'https://missing.invalid',
    })
    session.goBack(contents)

    mainFrameNavigationStarted(mockContents)

    expect(session.canGoForward(contents)).toBe(false)
  })

  it('discards synthetic Forward after same-document traversal and a fresh navigation', () => {
    const mockContents = (session.ensureTab().view as unknown as MockView).webContents
    const contents = mockContents as unknown as WebContents
    mockContents.navigationHistory.getActiveIndex.mockReturnValue(3)
    session.recordPageLoadFailure(contents, {
      kind: 'load-error',
      code: -102,
      description: 'ERR_CONNECTION_REFUSED',
      url: 'https://example.com/failed',
    })

    session.goBack(contents)
    mockContents.navigationHistory.canGoBack.mockReturnValue(true)
    expect(session.goBack(contents)).toBe(true)

    mainFrameNavigationStarted(mockContents, true)

    expect(session.canGoForward(contents)).toBe(true)

    mainFrameNavigationStarted(mockContents)

    expect(session.canGoForward(contents)).toBe(false)
  })

  it('keeps recovery state scoped to its tab while the user switches tabs', () => {
    const first = session.ensureTab()
    const second = session.addTab()
    const firstContents = (first.view as unknown as MockView).webContents as unknown as WebContents
    session.recordPageLoadFailure(firstContents, {
      kind: 'load-error',
      code: -105,
      description: 'ERR_NAME_NOT_RESOLVED',
      url: 'https://missing.invalid',
    })

    session.switchTab(second.id)
    expect(session.listTabs().find((tab) => tab.tabId === first.id)?.issue).toMatchObject({
      kind: 'load-error',
    })
    expect(session.listTabs().find((tab) => tab.tabId === second.id)).not.toHaveProperty('issue')

    session.switchTab(first.id)
    expect(session.requireTab().id).toBe(first.id)
    expect(session.pageIssueForContents(firstContents)).toMatchObject({ kind: 'load-error' })
  })

  it('hands focus to an accessible recovery page for active-tab failures', () => {
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    const onPageStateChanged = vi.fn()
    session = freshSession(win, { onPageStateChanged })
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    const mockContents = (session.ensureTab().view as unknown as MockView).webContents
    const contents = mockContents as unknown as WebContents

    session.recordPageLoadFailure(contents, {
      kind: 'load-error',
      code: -7,
      description: 'ERR_TIMED_OUT',
      url: 'https://slow.example.com',
    })

    expect(win.webContents.focus).toHaveBeenCalled()
    expect(onPageStateChanged).toHaveBeenCalledWith(contents)
  })

  it('recovers unresponsive tabs and clears the issue when Chromium responds again', () => {
    const mockContents = (session.ensureTab().view as unknown as MockView).webContents
    const contents = mockContents as unknown as WebContents
    mockContents.getURL.mockReturnValue('https://example.com')
    const unresponsive = mockContents.on.mock.calls.find(
      ([eventName]) => eventName === 'unresponsive'
    )?.[1] as (() => void) | undefined
    const responsive = mockContents.on.mock.calls.find(
      ([eventName]) => eventName === 'responsive'
    )?.[1] as (() => void) | undefined
    const gone = mockContents.on.mock.calls.find(
      ([eventName]) => eventName === 'render-process-gone'
    )?.[1] as ((event: unknown, details: { reason: string }) => void) | undefined

    unresponsive?.()
    expect(session.pageIssueForContents(contents)).toEqual({
      kind: 'unresponsive',
      url: 'https://example.com',
    })
    responsive?.()
    expect(session.pageIssueForContents(contents)).toBeUndefined()

    unresponsive?.()
    session.reloadPage(contents)
    expect(mockContents.forcefullyCrashRenderer).toHaveBeenCalled()
    gone?.({}, { reason: 'killed' })
    expect(mockContents.reload).toHaveBeenCalled()
  })

  it('drops the find when the user switches to another tab', () => {
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    const first = session.requireTab()
    const second = session.addTab()
    const firstContents = (first.view as unknown as MockView).webContents

    session.switchTab(first.id)
    session.findInActiveTab({ query: 'needle', newSession: true, forward: true })
    vi.mocked(win.webContents.send).mockClear()

    session.switchTab(second.id)
    expect(firstContents.stopFindInPage).toHaveBeenCalledWith('clearSelection')
    expect(win.webContents.send).toHaveBeenCalledWith('browser-agent:close-find', 'chat-test')
  })

  it('returns focus to the page only when the user dismissed the bar', () => {
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    const tab = session.requireTab()
    const contents = (tab.view as unknown as MockView).webContents

    // Panel teardown: the bar unmounts under a user who has already moved on,
    // so pulling focus back into the browser would drag them back to it.
    session.findInActiveTab({ query: 'needle', newSession: true, forward: true })
    contents.focus.mockClear()
    session.stopFindInActiveTab(false)
    expect(contents.focus).not.toHaveBeenCalled()

    session.findInActiveTab({ query: 'needle', newSession: true, forward: true })
    contents.focus.mockClear()
    session.stopFindInActiveTab(true)
    expect(contents.focus).toHaveBeenCalled()
  })

  it('returns focus to the page even when no search was running', () => {
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    const tab = session.requireTab()
    const contents = (tab.view as unknown as MockView).webContents

    // Opened and closed without typing. Focus still has to leave the bar: it is
    // unmounting, and <body> cannot receive the Mod+F that reopens it.
    contents.focus.mockClear()
    session.stopFindInActiveTab(true)
    expect(contents.focus).toHaveBeenCalled()

    // Same once the box is emptied — clearing the query ends the search, so
    // dismissing afterwards has no searched tab to key focus off either.
    session.findInActiveTab({ query: 'needle', newSession: true, forward: true })
    session.findInActiveTab({ query: '', newSession: true, forward: true })
    contents.focus.mockClear()
    session.stopFindInActiveTab(true)
    expect(contents.focus).toHaveBeenCalled()
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

    expect(session.handleFocusedShortcut('close-tab')).toBe(true)
    expect(session.listTabs()).toHaveLength(1)
    expect(session.listTabs()[0].tabId).toBe(first.id)
    expect(firstContents.focus).toHaveBeenCalledOnce()

    // Focus ownership transfers with the close, so a repeated Mod+W closes
    // the newly active tab even if Electron has not emitted its focus event.
    expect(session.handleFocusedShortcut('close-tab')).toBe(true)
    expect(session.listTabs()).toHaveLength(1)
    expect(session.listTabs()[0].tabId).not.toBe(first.id)

    // The replacement is an untouched about:blank tab. It still owns the
    // browser context, so it must not require a page load or another click.
    const blankTabId = session.listTabs()[0].tabId
    expect(session.handleFocusedShortcut('close-tab')).toBe(true)
    expect(session.listTabs()).toHaveLength(1)
    expect(session.listTabs()[0].tabId).not.toBe(blankTabId)

    session.setPanelFocused(false)
    panel.setPanelBounds(null)
    expect(session.handleFocusedShortcut('close-tab')).toBe(false)
    expect(session.listTabs()).toHaveLength(1)
  })

  it('keeps close-tab routed to a visible browser through a transient focus loss', () => {
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    const first = session.requireTab()
    const second = session.addTab()

    session.setPanelFocused(true)
    expect(session.handleFocusedShortcut('close-tab')).toBe(true)
    expect(session.listTabs()).toHaveLength(1)
    expect(session.listTabs()[0].tabId).toBe(first.id)
    expect(session.listTabs()[0].tabId).not.toBe(second.id)

    session.setPanelFocused(false)
    expect(session.handleFocusedShortcut('close-tab')).toBe(true)
    expect(session.listTabs()).toHaveLength(1)

    panel.setPanelBounds(null)
    expect(session.handleFocusedShortcut('close-tab')).toBe(false)
  })

  it('keeps browser tab shortcuts routed while the visible panel has no DOM focus', () => {
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    session.requireTab()
    session.setPanelFocused(false)
    const before = session.listTabs().length

    expect(session.handleFocusedShortcut('new-tab')).toBe(true)
    expect(session.listTabs()).toHaveLength(before + 1)
    expect(session.handleFocusedShortcut('close-tab')).toBe(true)
    expect(session.listTabs()).toHaveLength(before)
    expect(session.handleFocusedShortcut('reopen-closed-tab')).toBe(true)
    expect(session.listTabs()).toHaveLength(before + 1)

    vi.mocked(win.webContents.send).mockClear()
    expect(session.handleFocusedShortcut('focus-omnibox')).toBe(true)
    expect(win.webContents.send).toHaveBeenCalledWith(
      'browser-agent:focus-omnibox',
      'select',
      session.getBrowserScopeId()
    )

    panel.setPanelBounds(null)
    expect(session.handleFocusedShortcut('new-tab')).toBe(false)
    expect(session.handleFocusedShortcut('reopen-closed-tab')).toBe(false)
    expect(session.handleFocusedShortcut('focus-omnibox')).toBe(false)
  })

  it('reloads only the focused browser tab', () => {
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

    // Application-menu dispatch can blur the native tab before its click
    // callback, so the captured owner must still win for this turn.
    focusListener?.()
    blurListener?.()
    expect(session.handleFocusedShortcut('reload-or-clear')).toBe(true)
    expect(secondContents.reload).toHaveBeenCalledOnce()
    expect(firstContents.reload).not.toHaveBeenCalled()

    session.setPanelFocused(false)
    expect(session.handleFocusedShortcut('reload-or-clear')).toBe(false)
    expect(secondContents.reload).toHaveBeenCalledOnce()
  })

  it('does not reload a browser tab owned by another app window', () => {
    const otherWindow = mainWindowMock()
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 }, win)
    const tab = session.requireTab()
    const contents = (tab.view as unknown as MockView).webContents

    session.setPanelFocused(true, win)
    expect(session.handleFocusedShortcut('reload-or-clear', otherWindow)).toBe(false)
    expect(contents.reload).not.toHaveBeenCalled()

    expect(session.handleFocusedShortcut('reload-or-clear', win)).toBe(true)
    expect(contents.reload).toHaveBeenCalledOnce()
  })

  it('zooms only the focused browser tab', () => {
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    const tab = session.requireTab()
    const contents = (tab.view as unknown as MockView).webContents
    contents.getZoomFactor.mockReturnValue(1)

    session.setPanelFocused(true)
    expect(session.handleFocusedShortcut('zoom-in')).toBe(true)
    expect(contents.setZoomFactor).toHaveBeenLastCalledWith(steppedZoomFactor(1, 1))

    expect(session.handleFocusedShortcut('zoom-out')).toBe(true)
    expect(contents.setZoomFactor).toHaveBeenLastCalledWith(steppedZoomFactor(1, -1))

    expect(session.handleFocusedShortcut('zoom-reset')).toBe(true)
    expect(contents.setZoomFactor).toHaveBeenLastCalledWith(session.getBrowserDefaultZoomFactor())

    session.setPanelFocused(false)
    expect(session.handleFocusedShortcut('zoom-in')).toBe(false)
  })

  it('unthrottles only the active tab while automation is active', () => {
    const active = session.ensureTab()
    const activeContents = (active.view as unknown as MockView).webContents
    const background = session.addTab()
    const backgroundContents = (background.view as unknown as MockView).webContents
    // addTab activated the second tab; put focus back on the first.
    session.switchTab(active.id)
    activeContents.setBackgroundThrottling.mockClear()
    backgroundContents.setBackgroundThrottling.mockClear()

    session.setAutomationActive(true)
    // The waking is scoped to the active tab; the background tab stays throttled.
    expect(activeContents.setBackgroundThrottling).toHaveBeenLastCalledWith(false)
    expect(backgroundContents.setBackgroundThrottling).toHaveBeenLastCalledWith(true)

    session.setAutomationActive(false)
    expect(activeContents.setBackgroundThrottling).toHaveBeenLastCalledWith(true)
  })

  it('moves the automation exemption with the agent cursor, not visible selection', () => {
    const first = session.ensureTab()
    const second = session.addTab()
    session.switchTab(first.id)
    const firstContents = (first.view as unknown as MockView).webContents
    const secondContents = (second.view as unknown as MockView).webContents

    session.setAutomationActive(true)
    firstContents.setBackgroundThrottling.mockClear()
    secondContents.setBackgroundThrottling.mockClear()

    session.switchAutomationTab(second.id)

    // The old active tab is re-throttled, the new one exempted — otherwise a
    // mid-tool switch would strand the wake on a tab the agent left behind.
    expect(firstContents.setBackgroundThrottling).toHaveBeenLastCalledWith(true)
    expect(secondContents.setBackgroundThrottling).toHaveBeenLastCalledWith(false)
  })

  it('keeps the user-visible tab selected while the agent opens and switches background tabs', () => {
    const first = session.ensureTab()
    const visible = session.addTab()

    session.switchAutomationTab(first.id)
    const background = session.addAutomationTab()

    expect(session.getTabsState().activeTabId).toBe(visible.id)
    expect(session.getTabsState().automationTabId).toBe(background.id)
    expect(session.getTabsState().tabs.find((tab) => tab.active)?.tabId).toBe(visible.id)
  })

  it('refuses to let automation close a visible tab claimed by the user', () => {
    const visible = session.ensureTab()
    session.switchTab(visible.id)

    expect(() => session.closeAutomationTab(visible.id)).toThrow('currently being used by the user')
    expect(session.getTabsState().activeTabId).toBe(visible.id)
  })

  it('keeps agent actions on a tab after the user selects it', () => {
    const visible = session.ensureTab()
    session.switchTab(visible.id)

    const agent = session.ensureAutomationTab()

    expect(agent.id).toBe(visible.id)
    expect(session.getTabsState().activeTabId).toBe(visible.id)
    expect(session.getTabsState().automationTabId).toBe(visible.id)
    expect(session.listTabs()).toHaveLength(1)
  })

  it('keeps agent actions on a tab after a toolbar action claims it', () => {
    const visible = session.ensureTab()

    expect(session.claimActiveTabForUser()?.id).toBe(visible.id)
    expect(session.listTabs()).toHaveLength(1)

    const agent = session.ensureAutomationTab()
    expect(agent.id).toBe(visible.id)
    expect(session.listTabs()).toHaveLength(1)
  })

  it('does not treat a passive native focus event as user takeover', () => {
    const visible = session.ensureTab()
    const contents = (visible.view as unknown as MockView).webContents
    const focusListener = contents.on.mock.calls.find(
      ([eventName]) => eventName === 'focus'
    )?.[1] as (() => void) | undefined

    focusListener?.()

    expect(session.ensureAutomationTab().id).toBe(visible.id)
    expect(session.listTabs()).toHaveLength(1)
  })

  it('keeps automation on the same tab after real page interaction', () => {
    const visible = session.ensureTab()
    const contents = (visible.view as unknown as MockView).webContents
    const beforeMouse = contents.on.mock.calls.find(
      ([eventName]) => eventName === 'before-mouse-event'
    )?.[1] as ((event: unknown, input: { type: string }) => void) | undefined

    beforeMouse?.({}, { type: 'mouseDown' })

    expect(session.ensureAutomationTab().id).toBe(visible.id)
    expect(session.getTabsState().activeTabId).toBe(visible.id)
    expect(session.listTabs()).toHaveLength(1)
  })

  it('clears automation indicators instead of moving them when their tab closes', () => {
    const target = session.ensureAutomationTab()
    session.setAutomationActive(true)
    session.setAutomationNeedsAttention(true)

    session.closeTab(target.id)

    expect(session.getTabsState()).toMatchObject({
      automationActive: false,
      automationNeedsAttention: false,
    })
  })

  it('resumes takeover in the same tab after the user explicitly hands it back', () => {
    const visible = session.ensureTab()
    session.switchTab(visible.id)

    session.returnAutomationTabToAgent()

    expect(session.ensureAutomationTab().id).toBe(visible.id)
    expect(session.listTabs()).toHaveLength(1)
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
    const themedSession = freshSession(win, { onTabThemeChanged })
    const first = themedSession.ensureTab()
    const second = themedSession.addTab()

    themedSession.setBrowserTheme('dark')

    expect(onTabThemeChanged.mock.calls).toEqual([
      [first.view.webContents, 'dark'],
      [second.view.webContents, 'dark'],
    ])
  })

  it('applies the default zoom to every scope and retains it for future tabs', () => {
    const chatA = session.withBrowserScope('chat-a', () => session.ensureTab())
    const chatB = session.withBrowserScope('chat-b', () => session.ensureTab())
    const chatAContents = (chatA.view as unknown as MockView).webContents
    const chatBContents = (chatB.view as unknown as MockView).webContents
    const factor = BASE_ZOOM_FACTOR * 1.25

    session.setBrowserDefaultZoom(125)

    expect(session.getBrowserDefaultZoomFactor()).toBeCloseTo(factor)
    expect(chatAContents.setZoomFactor).toHaveBeenLastCalledWith(factor)
    expect(chatBContents.setZoomFactor).toHaveBeenLastCalledWith(factor)

    freshSession(win)
    expect(session.getBrowserDefaultZoomFactor()).toBe(BASE_ZOOM_FACTOR)
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

    expect(session.handleFocusedShortcut('reopen-closed-tab')).toBe(true)
    const reopened = session.activeTab()
    expect(reopened?.id).not.toBe(closed.id)
    const contents = (reopened?.view as unknown as MockView | undefined)?.webContents
    expect(contents?.loadURL).toHaveBeenCalledWith('https://example.com/')
    expect(contents?.focus).toHaveBeenCalled()

    session.setPanelFocused(false)
    panel.setPanelBounds(null)
    expect(session.handleFocusedShortcut('reopen-closed-tab')).toBe(false)
  })

  it('claims reopen while focused even when there is no closed tab', () => {
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    session.requireTab()
    session.setPanelFocused(true)

    expect(session.handleFocusedShortcut('reopen-closed-tab')).toBe(true)
    expect(session.listTabs()).toHaveLength(1)
  })

  it('keeps stale reports from another app window from hiding or controlling the browser panel', () => {
    const otherWindow = mainWindowMock()
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 }, win)
    session.ensureTab()
    vi.mocked(win.contentView.removeChildView).mockClear()

    panel.setPanelBounds(null, otherWindow)
    expect(win.contentView.removeChildView).not.toHaveBeenCalled()

    session.setPanelFocused(true, win)
    expect(session.handleFocusedShortcut('close-tab', otherWindow)).toBe(false)
    expect(session.handleFocusedShortcut('close-tab', win)).toBe(true)
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
    const { persistence, snapshots } = memoryBrowserPersistence()
    const pinnedSession = freshSession(win, {}, persistence)
    const first = pinnedSession.ensureTab()
    const second = pinnedSession.addTab()

    pinnedSession.setTabPinned(second.id, true)

    expect(pinnedSession.listTabs()).toEqual([
      expect.objectContaining({ tabId: second.id, pinned: true }),
      expect.objectContaining({ tabId: first.id, pinned: false }),
    ])
    expect(snapshots.get('chat-test')?.tabs).toEqual([
      { url: 'https://example.com/', pinned: true },
      { url: 'https://example.com/', pinned: false },
    ])
    expect(() => pinnedSession.closeTab(second.id)).toThrow(/Pinned tabs cannot be closed/)

    pinnedSession.setTabPinned(second.id, false)
    pinnedSession.closeTab(second.id)
    expect(pinnedSession.listTabs().map((tab) => tab.tabId)).toEqual([first.id])
    expect(snapshots.get('chat-test')?.tabs).toEqual([
      { url: 'https://example.com/', pinned: false },
    ])
  })

  it('opens native tab actions and keeps them bound to the right-clicked chat', () => {
    const first = session.withBrowserScope('chat-a', () => session.ensureTab())
    session.withBrowserScope('chat-b', () => session.ensureTab())
    vi.mocked(Menu.buildFromTemplate).mockClear()

    session.withBrowserScope('chat-a', () => session.showTabContextMenu(first.id))
    const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0]?.[0] as
      | MenuItemConstructorOptions[]
      | undefined
    expect(template?.filter((item) => item.type !== 'separator').map((item) => item.label)).toEqual(
      ['Pin Tab', 'Duplicate Tab', 'Close Tab']
    )

    session.activateBrowserScope('chat-b')
    const duplicate = template?.find((item) => item.label === 'Duplicate Tab')
    const clickDuplicate = duplicate?.click as (() => void) | undefined
    clickDuplicate?.()

    expect(session.withBrowserScope('chat-a', () => session.listTabs())).toHaveLength(2)
    expect(session.withBrowserScope('chat-b', () => session.listTabs())).toHaveLength(1)
  })

  it('restores pinned tabs when the browser resource opens again', async () => {
    const { persistence } = memoryBrowserPersistence({
      'chat-test': {
        v: 1,
        tabs: [{ url: 'https://docs.sim.ai/guide', pinned: true }],
        activeIndex: 0,
        downloads: [],
      },
    })
    const restoredSession = freshSession(win, {}, persistence)

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

  it('allows creation, duplication, and reopening beyond eight browser tabs', () => {
    const first = session.ensureTab()
    for (let index = 1; index < 12; index++) {
      session.addTab()
    }

    expect(session.listTabs()).toHaveLength(12)
    const duplicate = session.duplicateTab(first.id)
    expect(duplicate).not.toBeNull()
    expect(session.listTabs()).toHaveLength(13)
    if (!duplicate) throw new Error('expected the tab to be duplicated')

    session.closeTab(duplicate.id)
    expect(session.listTabs()).toHaveLength(12)
    expect(session.reopenClosedTab()).not.toBeNull()
    expect(session.listTabs()).toHaveLength(13)
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
    view.webContents.invalidate.mockClear()
    panel.setPanelBounds(null)
    expect(view.setVisible).toHaveBeenCalledWith(false)
    expect(view.webContents.invalidate).not.toHaveBeenCalled()
    expect(removeChildView).not.toHaveBeenCalled()

    // Showing it again reuses the attached view rather than re-adding it.
    content.addChildView.mockClear()
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
    expect(view.webContents.invalidate).toHaveBeenCalledOnce()
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
    expect(second.view.webContents.invalidate).toHaveBeenCalledOnce()
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
    // Production replaces the main window through the provider closure
    // (`() => getMainWindow()`), never by re-initialising the session — which
    // is what keeps the live tab across the swap, and the tab surviving is the
    // whole point of re-parenting it. Driving it the same way here.
    let host: BrowserWindow = win
    session = freshSession(() => host)
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
    host = replacement

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
    const zoomedSession = freshSession(winZoomed)

    const tab = zoomedSession.ensureTab()
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    expect((tab.view as unknown as MockView).setBounds).toHaveBeenCalledWith({
      x: 150,
      y: 75,
      width: 1200,
      height: 900,
    })
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

  it('brings an agent-opened working tab into view, unless the user claimed the visible one', () => {
    // browser_open_tab is the agent choosing a page to work in — the panel
    // follows it so the work is visible, which a popup deliberately does not.
    const first = session.ensureTab()
    const working = session.addAutomationTab({ reveal: true })
    expect(session.activeTab()).toBe(working)
    expect(working.id).not.toBe(first.id)

    // Once the user claims what they are looking at, the next agent tab opens
    // behind it rather than yanking the page out from under them.
    session.claimActiveTabForUser()
    const background = session.addAutomationTab({ reveal: true })
    expect(session.activeTab()).not.toBe(background)
  })

  it('keeps agent popups in the background and context-menu links user-owned', () => {
    const onTabCreated = vi.fn()
    session = freshSession(win, { onTabCreated })
    const sourceTab = session.ensureTab()
    const source = (sourceTab.view as unknown as MockView).webContents
    onTabCreated.mockClear()
    session.setAutomationActive(true)

    const openWindow = source.setWindowOpenHandler.mock.calls[0]?.[0] as (details: {
      url: string
    }) => { action: string }
    openWindow({ url: 'https://agent-popup.example/' })
    const agentPopup = session.automationTab()
    expect(agentPopup).not.toBeNull()
    expect(session.activeTab()).toBe(sourceTab)
    expect(onTabCreated).toHaveBeenLastCalledWith(agentPopup?.view.webContents)

    const contextMenu = source.on.mock.calls.find(
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

    const userTab = session.activeTab()
    expect(userTab).not.toBe(sourceTab)
    expect(session.automationTab()).toBe(agentPopup)
    expect(onTabCreated).toHaveBeenLastCalledWith(userTab?.view.webContents)
  })

  it('blocks controlled pages from moving or resizing the desktop window', () => {
    const tab = session.ensureTab()
    const contents = (tab.view as unknown as MockView).webContents
    const handler = contents.on.mock.calls.find(
      ([eventName]) => eventName === 'content-bounds-updated'
    )?.[1] as ((event: { preventDefault: () => void }) => void) | undefined
    const event = { preventDefault: vi.fn() }

    expect(handler).toBeTypeOf('function')
    handler?.(event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('grants media only after an active-page, origin-scoped user decision', async () => {
    vi.mocked(win.isFocused).mockReturnValue(true)
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    const tab = session.ensureTab()
    const contents = (tab.view as unknown as MockView).webContents
    contents.isFocused.mockReturnValue(true)
    const gestureHandler = contents.on.mock.calls.find(
      ([eventName]) => eventName === 'before-mouse-event'
    )?.[1] as ((_event: unknown, mouse: { type: string }) => void) | undefined
    gestureHandler?.({}, { type: 'mouseDown' })

    const ses = contents.session
    const requestHandler = ses.setPermissionRequestHandler.mock.calls[0][0] as (
      wc: unknown,
      permission: string,
      callback: (granted: boolean) => void,
      details?: unknown
    ) => void
    const checkHandler = ses.setPermissionCheckHandler.mock.calls[0][0] as (
      wc: unknown,
      permission: string,
      origin?: string,
      details?: unknown
    ) => boolean

    // Reading the clipboard would leak whatever the user last copied anywhere
    // else, so it stays denied alongside everything a page could spy through.
    for (const permission of ['geolocation', 'notifications', 'clipboard-read']) {
      const callback = vi.fn()
      requestHandler(null, permission, callback)
      expect(callback).toHaveBeenCalledWith(false)
      expect(checkHandler(null, permission)).toBe(false)
    }

    const mediaCallback = vi.fn()
    requestHandler(contents, 'media', mediaCallback, {
      isMainFrame: true,
      mediaTypes: ['audio'],
      requestingUrl: 'https://example.com/',
      securityOrigin: 'https://example.com',
    })
    expect(mediaCallback).not.toHaveBeenCalled()
    const prompt = session.mediaPermissionRequestForContents(contents as unknown as WebContents)
    expect(prompt).toMatchObject({
      origin: 'https://example.com',
      devices: ['microphone'],
    })

    await session.respondToMediaPermission(prompt?.requestId ?? '', true)

    expect(mediaCallback).toHaveBeenCalledWith(true)
    expect(
      checkHandler(contents, 'media', 'https://example.com', {
        isMainFrame: true,
        mediaType: 'audio',
      })
    ).toBe(true)
    expect(
      checkHandler(contents, 'media', 'https://example.com', {
        isMainFrame: true,
        mediaType: 'video',
      })
    ).toBe(false)
    expect(
      checkHandler(contents, 'media', 'https://other.example', {
        isMainFrame: true,
        mediaType: 'audio',
      })
    ).toBe(false)
    expect(
      checkHandler(contents, 'media', 'https://example.com', {
        isMainFrame: false,
        mediaType: 'audio',
      })
    ).toBe(false)

    mainFrameNavigationStarted(contents)
    expect(
      checkHandler(contents, 'media', 'https://example.com', {
        isMainFrame: true,
        mediaType: 'audio',
      })
    ).toBe(false)

    const staleGestureCallback = vi.fn()
    requestHandler(contents, 'media', staleGestureCallback, {
      isMainFrame: true,
      mediaTypes: ['audio'],
      requestingUrl: 'https://example.com/',
      securityOrigin: 'https://example.com',
    })
    expect(staleGestureCallback).toHaveBeenCalledWith(false)
    expect(
      session.mediaPermissionRequestForContents(contents as unknown as WebContents)
    ).toBeUndefined()

    // Chromium routes navigator.clipboard.writeText through this one; denying
    // it silently broke every copy button that does not use execCommand.
    const writeCallback = vi.fn()
    requestHandler(null, 'clipboard-sanitized-write', writeCallback)
    expect(writeCallback).toHaveBeenCalledWith(true)
    expect(checkHandler(null, 'clipboard-sanitized-write')).toBe(true)
  })

  it('default-denies hidden, subframe, origin-mismatched, and untyped media requests', () => {
    const tab = session.ensureTab()
    const contents = (tab.view as unknown as MockView).webContents
    const requestHandler = contents.session.setPermissionRequestHandler.mock.calls[0][0] as (
      wc: unknown,
      permission: string,
      callback: (granted: boolean) => void,
      details?: unknown
    ) => void

    vi.mocked(win.isFocused).mockReturnValue(true)
    contents.isFocused.mockReturnValue(true)
    const gestureHandler = contents.on.mock.calls.find(
      ([eventName]) => eventName === 'before-mouse-event'
    )?.[1] as ((_event: unknown, mouse: { type: string }) => void) | undefined
    gestureHandler?.({}, { type: 'mouseDown' })
    const hidden = vi.fn()
    requestHandler(contents, 'media', hidden, {
      isMainFrame: true,
      mediaTypes: ['audio'],
      requestingUrl: 'https://example.com/',
      securityOrigin: 'https://example.com',
    })
    expect(hidden).toHaveBeenCalledWith(false)

    for (const details of [
      {
        isMainFrame: false,
        mediaTypes: ['audio'],
        requestingUrl: 'https://example.com/',
        securityOrigin: 'https://example.com',
      },
      {
        isMainFrame: true,
        mediaTypes: [],
        requestingUrl: 'https://example.com/',
        securityOrigin: 'https://example.com',
      },
      {
        isMainFrame: true,
        mediaTypes: ['audio'],
        requestingUrl: 'https://other.example/',
        securityOrigin: 'https://other.example',
      },
    ]) {
      const callback = vi.fn()
      requestHandler(contents, 'media', callback, details)
      expect(callback).toHaveBeenCalledWith(false)
    }

    expect(
      session.mediaPermissionRequestForContents(contents as unknown as WebContents)
    ).toBeFalsy()
  })

  it('denies a pending media request when its document navigates or tab closes', () => {
    vi.mocked(win.isFocused).mockReturnValue(true)
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    const tab = session.ensureTab()
    const contents = (tab.view as unknown as MockView).webContents
    contents.isFocused.mockReturnValue(true)
    const gestureHandler = contents.on.mock.calls.find(
      ([eventName]) => eventName === 'before-mouse-event'
    )?.[1] as ((_event: unknown, mouse: { type: string }) => void) | undefined
    const requestHandler = contents.session.setPermissionRequestHandler.mock.calls[0][0] as (
      wc: unknown,
      permission: string,
      callback: (granted: boolean) => void,
      details?: unknown
    ) => void
    const request = (callback: (granted: boolean) => void) => {
      gestureHandler?.({}, { type: 'mouseDown' })
      requestHandler(contents, 'media', callback, {
        isMainFrame: true,
        mediaTypes: ['audio', 'video'],
        requestingUrl: 'https://example.com/',
        securityOrigin: 'https://example.com',
      })
    }

    const navigated = vi.fn()
    request(navigated)
    mainFrameNavigationStarted(contents)
    expect(navigated).toHaveBeenCalledWith(false)

    const closed = vi.fn()
    request(closed)
    session.closeTab(tab.id)
    expect(closed).toHaveBeenCalledWith(false)
  })

  it('keeps the site denied when the operating system rejects an approved device', async () => {
    setPlatform('darwin')
    try {
      vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('not-determined')
      vi.mocked(systemPreferences.askForMediaAccess).mockResolvedValue(false)
      win.isFocused = vi.fn(() => true)
      panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
      const tab = session.ensureTab()
      const contents = (tab.view as unknown as MockView).webContents
      contents.isFocused.mockReturnValue(true)
      const gestureHandler = contents.on.mock.calls.find(
        ([eventName]) => eventName === 'before-mouse-event'
      )?.[1] as ((_event: unknown, mouse: { type: string }) => void) | undefined
      gestureHandler?.({}, { type: 'mouseDown' })
      const requestHandler = contents.session.setPermissionRequestHandler.mock.calls[0][0] as (
        wc: unknown,
        permission: string,
        callback: (granted: boolean) => void,
        details?: unknown
      ) => void
      const callback = vi.fn()
      requestHandler(contents, 'media', callback, {
        isMainFrame: true,
        mediaTypes: ['video'],
        requestingUrl: 'https://example.com/',
        securityOrigin: 'https://example.com',
      })

      const prompt = session.mediaPermissionRequestForContents(contents as unknown as WebContents)
      await session.respondToMediaPermission(prompt?.requestId ?? '', true)

      expect(systemPreferences.askForMediaAccess).toHaveBeenCalledWith('camera')
      expect(callback).toHaveBeenCalledWith(false)
    } finally {
      setPlatform(realPlatform)
      vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('granted')
      vi.mocked(systemPreferences.askForMediaAccess).mockResolvedValue(true)
    }
  })

  it('fails a media prompt closed when the user does not answer it', async () => {
    vi.useFakeTimers()
    try {
      win.isFocused = vi.fn(() => true)
      panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
      const tab = session.ensureTab()
      const contents = (tab.view as unknown as MockView).webContents
      contents.isFocused.mockReturnValue(true)
      const gestureHandler = contents.on.mock.calls.find(
        ([eventName]) => eventName === 'before-mouse-event'
      )?.[1] as ((_event: unknown, mouse: { type: string }) => void) | undefined
      gestureHandler?.({}, { type: 'mouseDown' })
      const requestHandler = contents.session.setPermissionRequestHandler.mock.calls[0][0] as (
        wc: unknown,
        permission: string,
        callback: (granted: boolean) => void,
        details?: unknown
      ) => void
      const callback = vi.fn()
      requestHandler(contents, 'media', callback, {
        isMainFrame: true,
        mediaTypes: ['audio'],
        requestingUrl: 'https://example.com/',
        securityOrigin: 'https://example.com',
      })

      await vi.advanceTimersByTimeAsync(30_000)

      expect(callback).toHaveBeenCalledWith(false)
      expect(
        session.mediaPermissionRequestForContents(contents as unknown as WebContents)
      ).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves nothing of the signed-out user behind in the browser profile', async () => {
    const clearStorageData = vi.fn(async () => {})
    const clearCache = vi.fn(async () => {})
    vi.mocked(electronSession.fromPartition).mockReturnValue({
      clearStorageData,
      clearCache,
    } as unknown as ReturnType<typeof electronSession.fromPartition>)
    const { persistence, snapshots } = memoryBrowserPersistence()
    session = freshSession(win, {}, persistence)

    panel.setPanelBounds({ x: 0, y: 0, width: 800, height: 600 })
    const survivor = (session.ensureTab().view as unknown as MockView).webContents
    session.closeTab(session.addTab().id)
    expect(session.reopenClosedTab()).not.toBeNull()

    await session.clearProfileStorage()

    expect(survivor.close).toHaveBeenCalled()
    expect(session.listTabs()).toHaveLength(0)
    // Reopen Closed Tab must not resurrect the previous account's browsing.
    expect(session.reopenClosedTab()).toBeNull()
    expect(snapshots.get('chat-test')).toMatchObject({ tabs: [], activeIndex: -1 })
    expect(clearStorageData).toHaveBeenCalled()
    expect(clearCache).toHaveBeenCalled()
  })

  it('does not rewrite the settings file when the pinned tabs have not changed', async () => {
    const { persistence } = memoryBrowserPersistence()
    session = freshSession(win, {}, persistence)
    const tab = session.ensureTab()
    const contents = (tab.view as unknown as MockView).webContents
    const onNavigate = contents.on.mock.calls.find(
      ([eventName]) => eventName === 'did-navigate-in-page'
    )?.[1] as () => void
    vi.mocked(persistence.save).mockClear()

    // Any single-page app fires this on every route change, and the settings
    // store's `===` comparison never matches a freshly built array — so each
    // one used to mean a synchronous whole-file write on the main thread.
    onNavigate()
    onNavigate()
    onNavigate()

    expect(persistence.save).not.toHaveBeenCalled()
  })

  it('persists once when a tab actually becomes pinned', async () => {
    const { persistence } = memoryBrowserPersistence()
    session = freshSession(win, {}, persistence)
    const tab = session.ensureTab()
    ;(tab.view as unknown as MockView).webContents.getURL.mockReturnValue('https://example.com/')
    vi.mocked(persistence.save).mockClear()

    session.setTabPinned(tab.id, true)

    expect(persistence.save).toHaveBeenCalledTimes(1)
    expect(persistence.save).toHaveBeenLastCalledWith(
      'chat-test',
      expect.objectContaining({ tabs: [{ url: 'https://example.com/', pinned: true }] })
    )
  })

  it('keeps a crashed tab recoverable without disturbing sibling tabs', () => {
    const first = session.ensureTab()
    const second = session.addTab()
    const crashed = (second.view as unknown as MockView).webContents
    const onGone = crashed.on.mock.calls.find(
      ([eventName]) => eventName === 'render-process-gone'
    )?.[1] as (event: unknown, details: { reason: string }) => void

    onGone({}, { reason: 'crashed' })

    expect(session.listTabs()).toEqual([
      expect.objectContaining({ tabId: first.id }),
      expect.objectContaining({
        tabId: second.id,
        issue: expect.objectContaining({ kind: 'crashed', reason: 'crashed' }),
      }),
    ])
    expect(session.requireTab().id).toBe(second.id)
  })

  it('keeps the only crashed tab open for recovery', async () => {
    const onSessionClosed = vi.fn()
    session = freshSession(win, { onSessionClosed })
    const contents = (session.ensureTab().view as unknown as MockView).webContents
    const onGone = contents.on.mock.calls.find(
      ([eventName]) => eventName === 'render-process-gone'
    )?.[1] as (event: unknown, details: { reason: string }) => void

    onGone({}, { reason: 'oom' })

    expect(session.listTabs()).toEqual([
      expect.objectContaining({
        issue: expect.objectContaining({ kind: 'crashed', reason: 'oom' }),
      }),
    ])
    expect(onSessionClosed).not.toHaveBeenCalled()
  })

  it('hides the panel when the renderer stops renewing its bounds lease', async () => {
    vi.useFakeTimers()
    try {
      session = freshSession(win)
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
      session = freshSession(win)
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

  it('saves downloads to the configured folder instead of cancelling them', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sim-browser-downloads-'))
    const { persistence, snapshots } = memoryBrowserPersistence()
    const onDownloadsChanged = vi.fn()
    session = freshSession(win, { onDownloadsChanged }, persistence, {
      getDirectory: () => directory,
    })
    const contents = (session.ensureTab().view as unknown as MockView).webContents
    const webSession = contents.session as typeof contents.session & {
      on: ReturnType<typeof vi.fn>
    }
    const willDownload = webSession.on.mock.calls.find(
      ([eventName]) => eventName === 'will-download'
    )?.[1] as
      | ((event: unknown, item: Record<string, unknown>, contents: unknown) => void)
      | undefined
    const item = {
      getFilename: vi.fn(() => 'report.csv'),
      getMimeType: vi.fn(() => 'text/csv'),
      getReceivedBytes: vi.fn(() => 20),
      getTotalBytes: vi.fn(() => 100),
      setSavePath: vi.fn(),
      cancel: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
    }

    willDownload?.({}, item, contents)

    expect(item.cancel).not.toHaveBeenCalled()
    expect(item.setSavePath).toHaveBeenCalledWith(join(directory, 'report.csv'))
    expect(item.once).toHaveBeenCalledWith('done', expect.any(Function))
    expect(onDownloadsChanged).toHaveBeenLastCalledWith({
      scopeId: 'chat-test',
      downloads: [
        expect.objectContaining({
          filename: 'report.csv',
          state: 'progressing',
          receivedBytes: 20,
          totalBytes: 100,
        }),
      ],
    })
    expect(onDownloadsChanged.mock.calls.at(-1)?.[0].downloads[0]).not.toHaveProperty('savePath')

    const done = item.once.mock.calls.find(([eventName]) => eventName === 'done')?.[1] as
      | ((event: unknown, state: 'completed') => void)
      | undefined
    writeFileSync(join(directory, 'report.csv'), 'report')
    done?.({}, 'completed')

    expect(session.getBrowserDownloadsState('chat-test').downloads[0]).toMatchObject({
      filename: 'report.csv',
      state: 'completed',
    })
    expect(snapshots.get('chat-test')?.downloads[0]).toMatchObject({
      filename: 'report.csv',
      state: 'completed',
      savePath: join(directory, 'report.csv'),
    })

    vi.mocked(Menu.buildFromTemplate).mockClear()
    vi.mocked(shell.showItemInFolder).mockClear()
    expect(session.showBrowserDownloadsMenu('chat-test', win, { x: 10, y: 20 })).toBe(true)
    const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0]?.[0] as
      | MenuItemConstructorOptions[]
      | undefined
    expect(template?.[0]).toMatchObject({ label: 'report.csv', sublabel: '20 B', enabled: true })
    const reveal = template?.[0]?.click as (() => void) | undefined
    reveal?.()
    expect(shell.showItemInFolder).toHaveBeenCalledWith(join(directory, 'report.csv'))

    session = freshSession(win, {}, persistence, { getDirectory: () => directory })
    session.restoreBrowserSession()
    expect(session.getBrowserDownloadsState('chat-test').downloads[0]).toMatchObject({
      filename: 'report.csv',
      state: 'completed',
    })
  })

  it('does not recreate a disposed scope when a download finishes later', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sim-browser-downloads-'))
    const { persistence, snapshots } = memoryBrowserPersistence()
    session = freshSession(win, {}, persistence, { getDirectory: () => directory })
    const contents = (session.ensureTab().view as unknown as MockView).webContents
    const webSession = contents.session as typeof contents.session & {
      on: ReturnType<typeof vi.fn>
    }
    const willDownload = webSession.on.mock.calls.find(
      ([eventName]) => eventName === 'will-download'
    )?.[1] as
      | ((event: unknown, item: Record<string, unknown>, contents: unknown) => void)
      | undefined
    const item = {
      getFilename: vi.fn(() => 'late.txt'),
      getMimeType: vi.fn(() => 'text/plain'),
      getReceivedBytes: vi.fn(() => 4),
      getTotalBytes: vi.fn(() => 4),
      setSavePath: vi.fn(),
      cancel: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
    }
    willDownload?.({}, item, contents)
    const done = item.once.mock.calls.find(([eventName]) => eventName === 'done')?.[1] as
      | ((event: unknown, state: 'completed') => void)
      | undefined

    session.disposeBrowserScope('chat-test')
    done?.({}, 'completed')

    expect(session.getBrowserDownloadsState('chat-test').downloads).toEqual([])
    expect(snapshots.has('chat-test')).toBe(false)
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
    session = freshSession(win)
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
})

describe('reopening a closed tab', () => {
  let win: BrowserWindow
  let session: SessionModule

  beforeEach(async () => {
    win = mainWindowMock()
    session = freshSession(win)
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

describe('importAgentCookies', () => {
  /** Points the mocked partition at a cookie jar and returns its `set` spy. */
  function withCookieJar(set: ReturnType<typeof vi.fn>): SessionModule {
    // The partition is resolved per call, not captured at module load, so
    // re-mocking it here is enough — no module reload required.
    vi.mocked(electronSession.fromPartition).mockReturnValue({
      cookies: { set },
    } as unknown as ReturnType<typeof electronSession.fromPartition>)
    return sessionModule
  }

  const cookie = (name: string) => ({
    url: 'https://example.com/',
    name,
    value: 'v',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'lax' as const,
  })

  it('writes every cookie into the dedicated browser profile', async () => {
    const set = vi.fn(async () => {})
    const session = withCookieJar(set)

    const result = await session.importAgentCookies([cookie('a'), cookie('b')])

    expect(result).toEqual({ imported: 2, failed: 0 })
    expect(electronSession.fromPartition).toHaveBeenCalledWith('persist:sim-browser-agent')
    expect(set).toHaveBeenCalledTimes(2)
    expect(set).toHaveBeenNthCalledWith(1, cookie('a'))
  })

  it('counts a rejected cookie without losing the rest', async () => {
    // Chromium refuses cookies whose attributes are inconsistent. That
    // rejection must cost one cookie, not the whole import.
    const set = vi.fn(async (details: { name: string }) => {
      if (details.name === 'bad') throw new Error('Failed to set cookie')
    })
    const session = withCookieJar(set)

    const result = await session.importAgentCookies([cookie('a'), cookie('bad'), cookie('c')])

    expect(result).toEqual({ imported: 2, failed: 1 })
    expect(set).toHaveBeenCalledTimes(3)
  })

  it('does nothing when there is nothing to import', async () => {
    const set = vi.fn(async () => {})
    const session = withCookieJar(set)

    await expect(session.importAgentCookies([])).resolves.toEqual({ imported: 0, failed: 0 })
    expect(set).not.toHaveBeenCalled()
  })
})
