import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { MenuItemConstructorOptions, WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLookup } = vi.hoisted(() => ({ mockLookup: vi.fn() }))

vi.mock('electron', () => import('@/test/electron-mock'))
vi.mock('node:dns/promises', () => ({
  default: { lookup: mockLookup },
}))

import {
  BrowserWindow,
  dialog,
  session as electronSession,
  Menu,
  shell,
  WebContentsView,
} from 'electron'
import * as panel from '@/main/browser-agent/panel'
import { agentAppOrigin, routeAgentNavigation } from '@/main/browser-agent/registry'
import * as sessionModule from '@/main/browser-agent/session'
import type { BrowserSessionSnapshot } from '@/main/desktop-chat-session-store'

type SessionModule = typeof import('@/main/browser-agent/session')

const _realPlatform = process.platform

function _setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
}

type PopupHandler = (details: { url: string }) => {
  action: string
  outlivesOpener?: boolean
  createWindow?: (options: Record<string, unknown>) => unknown
}

interface MockView {
  webContents: {
    session: {
      setPermissionRequestHandler: ReturnType<typeof vi.fn>
      setPermissionCheckHandler: ReturnType<typeof vi.fn>
      setUserAgent: ReturnType<typeof vi.fn>
      webRequest: { onBeforeRequest: ReturnType<typeof vi.fn> }
    }
    on: ReturnType<typeof vi.fn>
    setUserAgent: ReturnType<typeof vi.fn>
    setWindowOpenHandler: ReturnType<typeof vi.fn>
    loadURL: ReturnType<typeof vi.fn>
    reload: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
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
  downloadSettings?: sessionModule.BrowserDownloadSettings,
  appSession?: sessionModule.BrowserAppSession
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
    downloadSettings,
    appSession
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
function _hostResizeHandler(win: BrowserWindow): () => void {
  const calls = (win as unknown as { on: ReturnType<typeof vi.fn> }).on.mock.calls
  const handler = calls.find(([event]) => event === 'resize')?.[1]
  if (typeof handler !== 'function') throw new Error('no host resize listener bound')
  return handler as () => void
}

function mainFrameNavigationStarted(
  contents: MockView['webContents'],
  isSameDocument = false,
  url = (contents.getURL as unknown as () => string)()
): void {
  const handler = contents.on.mock.calls
    .filter(([eventName]) => eventName === 'did-start-navigation')
    .at(-1)?.[1]
  if (typeof handler !== 'function') throw new Error('no navigation-start listener bound')
  handler({ isMainFrame: true, isSameDocument, url })
}

function beginMainFrameRequest(
  contents: MockView['webContents'],
  url: string,
  id = 1
): Promise<{ cancel: boolean }> {
  const handler = contents.session.webRequest.onBeforeRequest.mock.calls[0]?.[0]
  if (typeof handler !== 'function') throw new Error('no before-request listener bound')
  return new Promise((resolve) => {
    handler(
      {
        id,
        url,
        method: 'GET',
        webContents: contents,
        resourceType: 'mainFrame',
        referrer: (contents.getURL as unknown as () => string)(),
        timestamp: Date.now(),
        uploadData: [],
      },
      resolve
    )
  })
}

function beginSubresourceRequest(
  contents: MockView['webContents'],
  url: string,
  resourceType: string,
  id = 1
): Promise<{ cancel: boolean }> {
  const handler = contents.session.webRequest.onBeforeRequest.mock.calls[0]?.[0]
  if (typeof handler !== 'function') throw new Error('no before-request listener bound')
  return new Promise((resolve) => {
    handler(
      {
        id,
        url,
        method: 'GET',
        webContents: contents,
        resourceType,
        referrer: (contents.getURL as unknown as () => string)(),
        timestamp: Date.now(),
        uploadData: [],
      },
      resolve
    )
  })
}

type MockDownloadDoneState = 'completed' | 'cancelled' | 'interrupted'

interface MockDownloadHarness {
  item: {
    getFilename: ReturnType<typeof vi.fn>
    getMimeType: ReturnType<typeof vi.fn>
    getReceivedBytes: ReturnType<typeof vi.fn>
    getTotalBytes: ReturnType<typeof vi.fn>
    setSavePath: ReturnType<typeof vi.fn>
    pause: ReturnType<typeof vi.fn>
    resume: ReturnType<typeof vi.fn>
    cancel: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    once: ReturnType<typeof vi.fn>
  }
  setReceivedBytes: (bytes: number) => void
  setTotalBytes: (bytes: number) => void
  emitUpdated: (state?: 'progressing' | 'interrupted') => void
  emitDone: (state: MockDownloadDoneState) => void
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function mockDownloadItem({
  filename = 'report.csv',
  mimeType = 'text/csv',
  receivedBytes: initialReceivedBytes = 0,
  totalBytes: initialTotalBytes = 0,
}: {
  filename?: string
  mimeType?: string
  receivedBytes?: number
  totalBytes?: number
} = {}): MockDownloadHarness {
  let receivedBytes = initialReceivedBytes
  let totalBytes = initialTotalBytes
  const item = {
    getFilename: vi.fn(() => filename),
    getMimeType: vi.fn(() => mimeType),
    getReceivedBytes: vi.fn(() => receivedBytes),
    getTotalBytes: vi.fn(() => totalBytes),
    setSavePath: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
  }
  return {
    item,
    setReceivedBytes: (bytes) => {
      receivedBytes = bytes
    },
    setTotalBytes: (bytes) => {
      totalBytes = bytes
    },
    emitUpdated: (state = 'progressing') => {
      const handler = item.on.mock.calls.find(([eventName]) => eventName === 'updated')?.[1] as
        | ((event: unknown, nextState: 'progressing' | 'interrupted') => void)
        | undefined
      handler?.({}, state)
    },
    emitDone: (state) => {
      const handler = item.once.mock.calls.find(([eventName]) => eventName === 'done')?.[1] as
        | ((event: unknown, nextState: MockDownloadDoneState) => void)
        | undefined
      const savePath = item.setSavePath.mock.calls.at(-1)?.[0] as string | undefined
      if (state === 'completed' && savePath) writeFileSync(savePath, filename)
      handler?.({}, state)
    },
  }
}

/** Asserts Electron was only ever given the hidden staging file in `directory`. */
function expectOnlyStagingSavePath(
  item: { setSavePath: ReturnType<typeof vi.fn> },
  directory: string
) {
  expect(item.setSavePath).toHaveBeenCalledOnce()
  const savePath = item.setSavePath.mock.calls[0]?.[0] as string
  expect(dirname(savePath)).toBe(directory)
  expect(basename(savePath)).toMatch(/^\.sim-download-/)
  return savePath
}

/** Visible files in a download directory, excluding in-flight staging files. */
function finishedDownloadFiles(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => !name.startsWith('.'))
    .sort()
}

function startMockDownload(contents: MockView['webContents'], download: MockDownloadHarness): void {
  const webSession = contents.session as typeof contents.session & {
    on: ReturnType<typeof vi.fn>
  }
  const willDownload = webSession.on.mock.calls.find(
    ([eventName]) => eventName === 'will-download'
  )?.[1] as
    | ((event: unknown, item: MockDownloadHarness['item'], contents: unknown) => void)
    | undefined
  if (!willDownload) throw new Error('no will-download listener bound')
  willDownload({}, download.item, contents)
}

describe('browser-agent session', () => {
  let win: BrowserWindow
  let session: SessionModule

  beforeEach(async () => {
    mockLookup.mockReset()
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    win = mainWindowMock()
    session = freshSession(win)
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

  it('leaves every tab on the process-wide user agent instead of overriding it', () => {
    const first = session.ensureTab()
    const second = session.addTab()

    for (const tab of [first, second]) {
      const contents = (tab.view as unknown as MockView).webContents
      expect(contents.setUserAgent).not.toHaveBeenCalled()
      expect(contents.session.setUserAgent).not.toHaveBeenCalled()
    }
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

  it('migrates pending scope state and aliases callbacks to the durable chat id', () => {
    const tab = session.withBrowserScope('pending:workspace', () => session.ensureTab())
    session.activateBrowserScope('chat-real')

    expect(session.migrateBrowserScope('pending:workspace', 'chat-real')).toBe(true)
    expect(session.withBrowserScope('chat-real', () => session.activeTab())).toBe(tab)
    expect(session.withBrowserScope('pending:workspace', () => session.activeTab())).toBe(tab)

    session.withBrowserScope('occupied', () => session.ensureTab())
    expect(session.migrateBrowserScope('chat-real', 'occupied')).toBe(false)
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
    session.withBrowserScope('chat-a', () => session.switchTab(second.id))

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
        { tabId: '1', url: 'https://one.example/', active: false },
        { tabId: '2', url: 'https://two.example/', active: true },
      ],
    })
    expect(session.withBrowserScope('chat-a', () => session.activeTab()?.view)).not.toBe(
      second.view
    )
  })

  it('selects and starts the active restore before three bounded background loads', async () => {
    const tabs = Array.from({ length: 7 }, (_, index) => ({
      url: `https://restore-${index}.example/`,
    }))
    const { persistence } = memoryBrowserPersistence({
      'chat-restore-order': {
        v: 1,
        tabs,
        activeIndex: 5,
        downloads: [],
      },
    })
    const createdContents: MockView['webContents'][] = []
    const resolveLoads: Array<(() => void) | undefined> = []
    session = freshSession(
      win,
      {
        onTabCreated: (webContents) => {
          const contents = webContents as unknown as MockView['webContents']
          const index = createdContents.push(contents) - 1
          contents.loadURL.mockImplementation(
            () =>
              new Promise<void>((resolve) => {
                resolveLoads[index] = resolve
              })
          )
        },
      },
      persistence
    )

    session.withBrowserScope('chat-restore-order', () => session.restoreBrowserSession())

    expect(
      session.withBrowserScope('chat-restore-order', () => session.getTabsState())
    ).toMatchObject({
      activeTabId: '6',
      tabs: [
        { tabId: '1' },
        { tabId: '2' },
        { tabId: '3' },
        { tabId: '4' },
        { tabId: '5' },
        { tabId: '6', active: true },
        { tabId: '7' },
      ],
    })
    expect(createdContents[5].loadURL).toHaveBeenCalledWith(tabs[5].url)
    expect(createdContents[5].loadURL.mock.invocationCallOrder[0]).toBeLessThan(
      createdContents[0].loadURL.mock.invocationCallOrder[0]
    )
    expect(
      createdContents.filter((contents) => contents.loadURL.mock.calls.length > 0)
    ).toHaveLength(4)
    expect(createdContents[3].loadURL).not.toHaveBeenCalled()

    resolveLoads[0]?.()
    await vi.waitFor(() => {
      expect(createdContents[3].loadURL).toHaveBeenCalledWith(tabs[3].url)
    })
  })

  it('preempts a background restore for a user-selected queued tab', async () => {
    const tabs = Array.from({ length: 7 }, (_, index) => ({
      url: `https://priority-${index}.example/`,
    }))
    const { persistence } = memoryBrowserPersistence({
      'chat-restore-priority': {
        v: 1,
        tabs,
        activeIndex: 0,
        downloads: [],
      },
    })
    const createdContents: MockView['webContents'][] = []
    const resolveLoads: Array<(() => void) | undefined> = []
    session = freshSession(
      win,
      {
        onTabCreated: (webContents) => {
          const contents = webContents as unknown as MockView['webContents']
          const index = createdContents.push(contents) - 1
          contents.loadURL.mockImplementation(
            () =>
              new Promise<void>((resolve) => {
                resolveLoads[index] = resolve
              })
          )
        },
      },
      persistence
    )

    session.withBrowserScope('chat-restore-priority', () => {
      session.restoreBrowserSession()
      session.switchTab('7')
      session.closeTab('5')
    })
    expect(createdContents[6].loadURL).toHaveBeenCalledWith(tabs[6].url)
    expect(
      createdContents.slice(1, 4).some((contents) => contents.stop.mock.calls.length > 0)
    ).toBe(true)
    resolveLoads[1]?.()
    expect(createdContents[4].loadURL).not.toHaveBeenCalled()

    resolveLoads[2]?.()
    await vi.waitFor(() => {
      expect(createdContents[5].loadURL).toHaveBeenCalledWith(tabs[5].url)
    })
    expect(createdContents[4].loadURL).not.toHaveBeenCalled()

    resolveLoads[3]?.()
    await vi.waitFor(() => {
      expect(createdContents[1].loadURL).toHaveBeenCalledTimes(2)
    })
  })

  it('releases hung global restore slots so another task can make progress', async () => {
    vi.useFakeTimers()
    try {
      const firstTabs = Array.from({ length: 6 }, (_, index) => ({
        url: `https://hung-a-${index}.example/`,
      }))
      const secondTabs = Array.from({ length: 2 }, (_, index) => ({
        url: `https://waiting-b-${index}.example/`,
      }))
      const { persistence } = memoryBrowserPersistence({
        'chat-hung-a': { v: 1, tabs: firstTabs, activeIndex: 0, downloads: [] },
        'chat-waiting-b': { v: 1, tabs: secondTabs, activeIndex: 0, downloads: [] },
      })
      const createdContents: MockView['webContents'][] = []
      session = freshSession(
        win,
        {
          onTabCreated: (webContents) => {
            const contents = webContents as unknown as MockView['webContents']
            createdContents.push(contents)
            contents.loadURL.mockImplementation(() => new Promise<void>(() => {}))
          },
        },
        persistence
      )

      session.withBrowserScope('chat-hung-a', () => session.restoreBrowserSession())
      session.withBrowserScope('chat-waiting-b', () => session.restoreBrowserSession())
      const waitingBackground = createdContents[7]
      expect(waitingBackground.loadURL).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(15_000)

      expect(
        createdContents.slice(1, 4).every((contents) => contents.stop.mock.calls.length > 0)
      ).toBe(true)
      expect(waitingBackground.loadURL).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(15_000)

      expect(waitingBackground.loadURL).toHaveBeenCalledWith(secondTabs[1].url)
    } finally {
      vi.useRealTimers()
    }
  })

  it('discards a queued restore before an explicit replacement navigation can race it', async () => {
    const tabs = Array.from({ length: 6 }, (_, index) => ({
      url: `https://stale-restore-${index}.example/`,
    }))
    const { persistence } = memoryBrowserPersistence({
      'chat-replace-restore': { v: 1, tabs, activeIndex: 0, downloads: [] },
    })
    const createdContents: MockView['webContents'][] = []
    const resolveLoads: Array<(() => void) | undefined> = []
    session = freshSession(
      win,
      {
        onTabCreated: (webContents) => {
          const contents = webContents as unknown as MockView['webContents']
          const index = createdContents.push(contents) - 1
          contents.loadURL.mockImplementation(
            () =>
              new Promise<void>((resolve) => {
                resolveLoads[index] = resolve
              })
          )
        },
      },
      persistence
    )

    session.withBrowserScope('chat-replace-restore', () => session.restoreBrowserSession())
    const queued = createdContents[5]
    const replacement = 'https://fresh.example/'
    session.withBrowserScope('chat-replace-restore', () => {
      session.prepareExplicitNavigation(queued as unknown as WebContents)
    })
    void (queued.loadURL as unknown as (url: string) => Promise<void>)(replacement)
    resolveLoads[1]?.()
    await Promise.resolve()
    await Promise.resolve()

    expect(queued.loadURL).toHaveBeenCalledOnce()
    expect(queued.loadURL).toHaveBeenCalledWith(replacement)
    expect(queued.loadURL).not.toHaveBeenCalledWith(tabs[5].url)
  })

  it('does not start queued restores after their task browser is suspended', async () => {
    const tabs = Array.from({ length: 6 }, (_, index) => ({
      url: `https://suspended-${index}.example/`,
    }))
    const { persistence } = memoryBrowserPersistence({
      'chat-restore-suspended': {
        v: 1,
        tabs,
        activeIndex: 0,
        downloads: [],
      },
    })
    const createdContents: MockView['webContents'][] = []
    const resolveLoads: Array<(() => void) | undefined> = []
    session = freshSession(
      win,
      {
        onTabCreated: (webContents) => {
          const contents = webContents as unknown as MockView['webContents']
          const index = createdContents.push(contents) - 1
          contents.loadURL.mockImplementation(
            () =>
              new Promise<void>((resolve) => {
                resolveLoads[index] = resolve
              })
          )
        },
      },
      persistence
    )

    session.withBrowserScope('chat-restore-suspended', () => session.restoreBrowserSession())
    expect(
      createdContents.filter((contents) => contents.loadURL.mock.calls.length > 0)
    ).toHaveLength(4)

    session.suspendBrowserScope('chat-restore-suspended')
    resolveLoads[1]?.()
    await Promise.resolve()
    await Promise.resolve()

    expect(
      createdContents.filter((contents) => contents.loadURL.mock.calls.length > 0)
    ).toHaveLength(4)
    expect(createdContents.every((contents) => contents.close.mock.calls.length === 1)).toBe(true)
  })

  it('bounds restored tabs while retaining the active page', () => {
    const tabs = Array.from({ length: 40 }, (_, index) => ({
      url: `https://tab-${index}.example/`,
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
    const savedTabs = [{ url: 'https://saved-one.example/' }, { url: 'https://saved-two.example/' }]
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
          { url: 'https://one.example/' },
          { url: 'https://two.example/' },
          { url: 'https://three.example/' },
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
        { tabId: '1', url: 'https://one.example/', active: false },
        { tabId: '2', url: 'https://two.example/', active: false },
        { tabId: '3', url: 'https://three.example/', active: true },
      ],
    })

    session.withBrowserScope('chat-retry', () => session.restoreBrowserSession())
    expect(createdContents).toHaveLength(5)
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
      tabs: [{ url: 'https://retained.example/' }],
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

  it('closes only the native browser tab targeted by the application menu accelerator', () => {
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    const first = session.ensureTab()
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
    expect(session.listTabs()).toHaveLength(0)

    session.setPanelFocused(false)
    panel.setPanelBounds(null)
    expect(session.handleFocusedShortcut('close-tab')).toBe(false)
    expect(session.listTabs()).toHaveLength(0)
  })

  it('does not reload a browser tab owned by another app window', () => {
    const otherWindow = mainWindowMock()
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 }, win)
    const tab = session.ensureTab()
    const contents = (tab.view as unknown as MockView).webContents

    session.setPanelFocused(true, win)
    expect(session.handleFocusedShortcut('reload-or-clear', otherWindow)).toBe(false)
    expect(contents.reload).not.toHaveBeenCalled()

    expect(session.handleFocusedShortcut('reload-or-clear', win)).toBe(true)
    expect(contents.reload).toHaveBeenCalledOnce()
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

  it('embeds the active view in the MAIN window only while panel bounds are reported', () => {
    const tab = session.ensureTab()
    const view = tab.view as unknown as MockView
    const content = (win as unknown as { contentView: { addChildView: ReturnType<typeof vi.fn> } })
      .contentView

    // No bounds yet: the agent's view is parked invisibly, never shown.
    expect(content.addChildView).toHaveBeenCalledWith(tab.view)
    expect(view.setVisible).toHaveBeenCalledWith(false)
    expect(view.setVisible).not.toHaveBeenCalledWith(true)

    // Bounds arrive: the parked view is adopted in place, not re-added.
    content.addChildView.mockClear()
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    expect(content.addChildView).not.toHaveBeenCalled()
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
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

  it('keeps the agent tab composited while the user views another tab, and releases it on close', () => {
    const agentTab = session.ensureTab()
    panel.setPanelBounds({ x: 0, y: 0, width: 800, height: 600 })
    const content = (
      win as unknown as {
        contentView: {
          addChildView: ReturnType<typeof vi.fn>
          removeChildView: ReturnType<typeof vi.fn>
        }
      }
    ).contentView
    const userTab = session.addTab()
    const agentView = agentTab.view as unknown as MockView

    // The user's tab is visible; the agent's tab is parked, still in the window.
    expect(content.removeChildView).not.toHaveBeenCalledWith(agentTab.view)
    expect(agentView.setVisible).toHaveBeenLastCalledWith(false)

    // Switching back adopts the parked view in place.
    content.addChildView.mockClear()
    session.switchTab(agentTab.id)
    expect(content.addChildView).not.toHaveBeenCalledWith(agentTab.view)
    expect(agentView.setVisible).toHaveBeenLastCalledWith(true)

    // Closing the agent tab while the user views another tab removes its parked view.
    session.switchTab(userTab.id)
    content.removeChildView.mockClear()
    session.closeTab(agentTab.id)
    expect(content.removeChildView).toHaveBeenCalledWith(agentTab.view)
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

  it('hardens every tab and keeps http popups inside a new internal tab', () => {
    const tab = session.ensureTab()
    const contents = (tab.view as unknown as MockView).webContents
    expect(contents.session.setPermissionRequestHandler).toHaveBeenCalled()
    expect(contents.session.setPermissionCheckHandler).toHaveBeenCalled()

    const openHandler = contents.setWindowOpenHandler.mock.calls[0][0] as PopupHandler
    const popup = openHandler({ url: 'https://example.com/popup' })
    expect(popup).toMatchObject({ action: 'allow', outlivesOpener: true })
    const adopted = popup.createWindow?.({ webContents: {} as never })
    expect(session.listTabs()).toHaveLength(2)
    const popupContents = (session.activeTab()?.view as unknown as MockView | undefined)
      ?.webContents
    expect(adopted).toBe(popupContents)
    // Chromium already navigates an adopted popup, which is what keeps window.opener.
    expect(popupContents?.loadURL).not.toHaveBeenCalled()
    expect(contents.loadURL).not.toHaveBeenCalledWith('https://example.com/popup')
    // Non-http(s) popups are denied without navigating anywhere.
    contents.loadURL.mockClear()
    expect(openHandler({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' })
    expect(contents.loadURL).not.toHaveBeenCalled()
  })

  it('opens a background-disposition popup by URL and keeps cross-scheme popups denied', () => {
    const source = (session.ensureTab().view as unknown as MockView).webContents
    const openWindow = source.setWindowOpenHandler.mock.calls[0]?.[0] as PopupHandler

    openWindow({ url: 'https://example.com/later' }).createWindow?.({})
    const popup = (session.activeTab()?.view as unknown as MockView).webContents
    expect(popup).not.toBe(source)
    expect(popup.loadURL).toHaveBeenCalledWith('https://example.com/later')
    expect(openWindow({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' })
    expect(session.listTabs()).toHaveLength(2)
  })

  it('lets internal page popups navigate after the network check', async () => {
    panel.setPanelBounds({ x: 100, y: 50, width: 800, height: 600 })
    const source = (session.ensureTab().view as unknown as MockView).webContents
    const openWindow = source.setWindowOpenHandler.mock.calls[0]?.[0] as PopupHandler
    const destination = 'http://127.0.0.1:4099/private?token=secret'

    openWindow({ url: destination }).createWindow?.({})
    const popup = (session.activeTab()?.view as unknown as MockView).webContents
    const request = beginMainFrameRequest(popup, destination)

    await expect(request).resolves.toEqual({ cancel: false })
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
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

  it.each(['mainFrame', 'subFrame'])(
    'retains private-network checks for %s navigation',
    async (resourceType) => {
      const contents = (session.ensureTab().view as unknown as MockView).webContents
      for (const url of ['http://169.254.169.254/', 'http://10.0.0.1/', 'file:///tmp/example']) {
        await expect(beginSubresourceRequest(contents, url, resourceType)).resolves.toEqual({
          cancel: true,
        })
      }
      mockLookup.mockResolvedValue([{ address: '192.168.0.1', family: 4 }])
      await expect(
        beginSubresourceRequest(contents, 'https://private-redirect.example/', resourceType)
      ).resolves.toEqual({ cancel: true })
      mockLookup.mockRejectedValue(new Error('DNS unavailable'))
      await expect(
        beginSubresourceRequest(contents, 'https://unresolved-redirect.example/', resourceType)
      ).resolves.toEqual({ cancel: true })
    }
  )

  it('blocks an image hostname that resolves to a private address', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }])
    const contents = (session.ensureTab().view as unknown as MockView).webContents

    await expect(
      beginSubresourceRequest(contents, 'https://private-image.evil.example/status.png', 'image')
    ).resolves.toEqual({ cancel: true })
    expect(mockLookup).toHaveBeenCalledWith('private-image.evil.example', {
      all: true,
      verbatim: true,
    })
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

  it('pauses downloads until the async disk check passes, then saves them', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sim-browser-downloads-'))
    const { persistence, snapshots } = memoryBrowserPersistence()
    const onDownloadsChanged = vi.fn()
    session = freshSession(win, { onDownloadsChanged }, persistence, {
      getDirectory: () => directory,
      getFreeDiskBytes: () => Number.MAX_SAFE_INTEGER,
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
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
    }

    willDownload?.({}, item, contents)

    expect(item.pause).toHaveBeenCalledOnce()
    expect(item.resume).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(item.resume).toHaveBeenCalledOnce())
    expect(item.cancel).not.toHaveBeenCalled()
    const stagingPath = expectOnlyStagingSavePath(item, directory)
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
    writeFileSync(stagingPath, 'report')
    done?.({}, 'completed')

    await vi.waitFor(() =>
      expect(session.getBrowserDownloadsState('chat-test').downloads[0]).toMatchObject({
        filename: 'report.csv',
        state: 'completed',
      })
    )
    expect(existsSync(stagingPath)).toBe(false)
    expect(finishedDownloadFiles(directory)).toEqual(['report.csv'])
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

    session = freshSession(win, {}, persistence, {
      getDirectory: () => directory,
      getFreeDiskBytes: () => Number.MAX_SAFE_INTEGER,
    })
    session.restoreBrowserSession()
    expect(session.getBrowserDownloadsState('chat-test').downloads[0]).toMatchObject({
      filename: 'report.csv',
      state: 'completed',
    })
  })

  it('never overwrites a file that takes the allocated name before the download claims it', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sim-browser-downloads-'))
    writeFileSync(join(directory, 'taken.bin'), 'user data')
    session = freshSession(win, {}, undefined, {
      getDirectory: () => directory,
      getFreeDiskBytes: () => Number.MAX_SAFE_INTEGER,
      pathExists: () => false,
    })
    const contents = (session.ensureTab().view as unknown as MockView).webContents
    const download = mockDownloadItem({ filename: 'taken.bin', totalBytes: 100 })

    startMockDownload(contents, download)

    await vi.waitFor(() => expect(download.item.cancel).toHaveBeenCalledOnce())
    expect(download.item.resume).not.toHaveBeenCalled()
    expect(readFileSync(join(directory, 'taken.bin'), 'utf8')).toBe('user data')
  })

  it('interrupts a completed download whose staging file cannot be moved into place', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sim-browser-downloads-'))
    const moveFile = vi.fn(() =>
      Promise.reject(Object.assign(new Error('cross-device link'), { code: 'EXDEV' }))
    )
    session = freshSession(win, {}, undefined, {
      getDirectory: () => directory,
      getFreeDiskBytes: () => Number.MAX_SAFE_INTEGER,
      moveFile,
    })
    const contents = (session.ensureTab().view as unknown as MockView).webContents
    const download = mockDownloadItem({ filename: 'blocked.bin', totalBytes: 100 })

    startMockDownload(contents, download)
    const stagingPath = expectOnlyStagingSavePath(download.item, directory)
    await vi.waitFor(() => expect(download.item.resume).toHaveBeenCalledOnce())
    expect(readFileSync(join(directory, 'blocked.bin'), 'utf8')).toBe('')
    download.emitDone('completed')

    await vi.waitFor(() =>
      expect(session.getBrowserDownloadsState('chat-test').downloads[0]).toMatchObject({
        filename: 'blocked.bin',
        state: 'interrupted',
      })
    )
    await vi.waitFor(() => expect(readdirSync(directory)).toEqual([]))
    expect(existsSync(stagingPath)).toBe(false)
    expect(moveFile).toHaveBeenCalledOnce()
    const { id } = session.getBrowserDownloadsState('chat-test').downloads[0]
    expect(session.completedBrowserDownload('chat-test', id)).toBeNull()

    vi.mocked(Menu.buildFromTemplate).mockClear()
    session.showBrowserDownloadsMenu('chat-test', win, { x: 10, y: 20 })
    const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0]?.[0] as
      | MenuItemConstructorOptions[]
      | undefined
    expect(template?.[0]?.sublabel).toContain(
      'the finished download could not be moved to its destination'
    )
  })

  it('removes the staging file when a download is cancelled or interrupted', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sim-browser-downloads-'))
    session = freshSession(win, {}, undefined, {
      getDirectory: () => directory,
      getFreeDiskBytes: () => Number.MAX_SAFE_INTEGER,
    })
    const contents = (session.ensureTab().view as unknown as MockView).webContents
    const cancelled = mockDownloadItem({ filename: 'cancelled.bin', totalBytes: 100 })
    const interrupted = mockDownloadItem({ filename: 'interrupted.bin', totalBytes: 100 })

    startMockDownload(contents, cancelled)
    startMockDownload(contents, interrupted)
    await vi.waitFor(() => expect(cancelled.item.resume).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(interrupted.item.resume).toHaveBeenCalledOnce())
    const stagingPaths = [
      expectOnlyStagingSavePath(cancelled.item, directory),
      expectOnlyStagingSavePath(interrupted.item, directory),
    ]
    for (const stagingPath of stagingPaths) writeFileSync(stagingPath, 'partial')

    cancelled.emitDone('cancelled')
    interrupted.emitDone('interrupted')

    await vi.waitFor(() => expect(readdirSync(directory)).toEqual([]))
    expect(session.getBrowserDownloadsState('chat-test').downloads).toEqual([
      expect.objectContaining({ filename: 'interrupted.bin', state: 'interrupted' }),
      expect.objectContaining({ filename: 'cancelled.bin', state: 'cancelled' }),
    ])
  })

  it('rejects a declared download above the byte cap with safe visible metadata', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sim-browser-downloads-'))
    session = freshSession(win, {}, undefined, {
      getDirectory: () => directory,
      getFreeDiskBytes: () => Number.MAX_SAFE_INTEGER,
    })
    const contents = (session.ensureTab().view as unknown as MockView).webContents
    const download = mockDownloadItem({
      filename: 'oversized.zip',
      totalBytes: 2 * 1024 ** 3 + 1,
    })

    startMockDownload(contents, download)

    expect(download.item.cancel).toHaveBeenCalledOnce()
    expect(download.item.setSavePath).not.toHaveBeenCalled()
    expect(session.getBrowserDownloadsState('chat-test').downloads).toEqual([
      expect.objectContaining({ filename: 'oversized.zip', state: 'interrupted' }),
    ])
    expect(session.getBrowserDownloadsState('chat-test').downloads[0]).not.toHaveProperty(
      'savePath'
    )
    expect(session.getBrowserDownloadsState('chat-test').downloads[0]).not.toHaveProperty(
      'interruptionReason'
    )

    vi.mocked(Menu.buildFromTemplate).mockClear()
    session.showBrowserDownloadsMenu('chat-test', win, { x: 10, y: 20 })
    const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0]?.[0] as
      | MenuItemConstructorOptions[]
      | undefined
    expect(template?.[0]).toMatchObject({
      label: 'oversized.zip',
      enabled: false,
    })
    expect(template?.[0]?.sublabel).toContain('2.0 GB download limit')
  })

  it('fails closed when the asynchronous free-space probe rejects', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sim-browser-downloads-'))
    session = freshSession(win, {}, undefined, {
      getDirectory: () => directory,
      getFreeDiskBytes: () => Promise.reject(new Error('disk unavailable')),
    })
    const contents = (session.ensureTab().view as unknown as MockView).webContents
    const download = mockDownloadItem({ filename: 'probe-error.bin', totalBytes: 100 })

    startMockDownload(contents, download)

    expect(download.item.pause).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(download.item.cancel).toHaveBeenCalledOnce())
    expect(download.item.resume).not.toHaveBeenCalled()
    expect(session.getBrowserDownloadsState('chat-test').downloads[0]).toMatchObject({
      filename: 'probe-error.bin',
      state: 'interrupted',
    })
  })

  it('fails a hung admission probe closed and ignores its late rejection', async () => {
    vi.useFakeTimers()
    try {
      const directory = mkdtempSync(join(tmpdir(), 'sim-browser-downloads-'))
      const probe = deferred<number>()
      const getFreeDiskBytes = vi.fn(() => probe.promise)
      session = freshSession(win, {}, undefined, {
        getDirectory: () => directory,
        getFreeDiskBytes,
      })
      const contents = (session.ensureTab().view as unknown as MockView).webContents
      const download = mockDownloadItem({ filename: 'hung-admission.bin', totalBytes: 100 })

      startMockDownload(contents, download)
      await vi.waitFor(() => expect(getFreeDiskBytes).toHaveBeenCalledOnce())
      expect(download.item.resume).not.toHaveBeenCalled()
      const timersDuringProbe = vi.getTimerCount()

      await vi.advanceTimersByTimeAsync(5_000)

      expect(download.item.cancel).toHaveBeenCalledOnce()
      expect(download.item.resume).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(timersDuringProbe - 1)
      probe.reject(new Error('late disk failure'))
      await vi.advanceTimersByTimeAsync(0)
      expect(download.item.cancel).toHaveBeenCalledOnce()
      expect(download.item.resume).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('counts slow pending admissions against the per-task concurrency cap', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sim-browser-downloads-'))
    const firstProbe = deferred<number>()
    const secondProbe = deferred<number>()
    const getFreeDiskBytes = vi
      .fn<(directory: string) => Promise<number>>()
      .mockReturnValueOnce(firstProbe.promise)
      .mockReturnValueOnce(secondProbe.promise)
    session = freshSession(win, {}, undefined, {
      getDirectory: () => directory,
      getFreeDiskBytes,
    })
    const contents = (session.ensureTab().view as unknown as MockView).webContents
    const first = mockDownloadItem({ filename: 'pending-a.bin', totalBytes: 100 })
    const second = mockDownloadItem({ filename: 'pending-b.bin', totalBytes: 100 })
    const blocked = mockDownloadItem({ filename: 'blocked.bin', totalBytes: 100 })

    startMockDownload(contents, first)
    startMockDownload(contents, second)
    startMockDownload(contents, blocked)

    expect(first.item.pause).toHaveBeenCalledOnce()
    expect(second.item.pause).toHaveBeenCalledOnce()
    expect(blocked.item.pause).not.toHaveBeenCalled()
    expect(blocked.item.setSavePath).not.toHaveBeenCalled()
    expect(blocked.item.cancel).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(getFreeDiskBytes).toHaveBeenCalledTimes(2))

    firstProbe.resolve(Number.MAX_SAFE_INTEGER)
    secondProbe.resolve(Number.MAX_SAFE_INTEGER)
    await vi.waitFor(() => expect(first.item.resume).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(second.item.resume).toHaveBeenCalledOnce())
  })

  it('stops an unknown-size download immediately when its received bytes cross the cap', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sim-browser-downloads-'))
    session = freshSession(win, {}, undefined, {
      getDirectory: () => directory,
      getFreeDiskBytes: () => Number.MAX_SAFE_INTEGER,
    })
    const contents = (session.ensureTab().view as unknown as MockView).webContents
    const download = mockDownloadItem({ filename: 'stream.bin' })

    startMockDownload(contents, download)
    await vi.waitFor(() => expect(download.item.resume).toHaveBeenCalledOnce())
    download.setReceivedBytes(2 * 1024 ** 3 + 1)
    download.emitUpdated()

    expect(download.item.cancel).toHaveBeenCalledOnce()
    expect(session.getBrowserDownloadsState('chat-test').downloads[0]).toMatchObject({
      filename: 'stream.bin',
      state: 'interrupted',
      receivedBytes: 2 * 1024 ** 3 + 1,
    })

    download.emitDone('cancelled')
    await vi.waitFor(() => expect(readdirSync(directory)).toEqual([]))
    const replacement = mockDownloadItem({ filename: 'stream.bin', totalBytes: 100 })
    startMockDownload(contents, replacement)
    expect(replacement.item.cancel).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(replacement.item.resume).toHaveBeenCalledOnce())
    replacement.emitDone('completed')
    await vi.waitFor(() => expect(finishedDownloadFiles(directory)).toEqual(['stream.bin']))
  })

  it('cancels every active download on profile wipe without reviving late work', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sim-browser-downloads-'))
    const firstProbe = deferred<number>()
    const secondProbe = deferred<number>()
    const { persistence, snapshots } = memoryBrowserPersistence()
    const getFreeDiskBytes = vi
      .fn<(directory: string) => number | Promise<number>>()
      .mockReturnValueOnce(firstProbe.promise)
      .mockReturnValueOnce(secondProbe.promise)
      .mockReturnValue(Number.MAX_SAFE_INTEGER)
    session = freshSession(win, {}, persistence, {
      getDirectory: () => directory,
      getFreeDiskBytes,
    })
    const contents = (session.ensureTab().view as unknown as MockView).webContents
    const first = mockDownloadItem({ filename: 'same-name.bin', totalBytes: 100 })
    const second = mockDownloadItem({ filename: 'same-name.bin', totalBytes: 100 })

    startMockDownload(contents, first)
    startMockDownload(contents, second)
    await vi.waitFor(() => expect(getFreeDiskBytes).toHaveBeenCalledTimes(2))

    await session.clearProfileStorage()

    expect(first.item.cancel).toHaveBeenCalledOnce()
    expect(second.item.cancel).toHaveBeenCalledOnce()
    expect(session.getBrowserDownloadsState('chat-test').downloads).toEqual([])

    firstProbe.resolve(Number.MAX_SAFE_INTEGER)
    secondProbe.reject(new Error('late profile probe rejection'))
    await Promise.resolve()
    await Promise.resolve()
    expect(first.item.resume).not.toHaveBeenCalled()
    expect(second.item.resume).not.toHaveBeenCalled()
    expect(session.getBrowserDownloadsState('chat-test').downloads).toEqual([])
    expect(snapshots.get('chat-test')?.downloads).toEqual([])
    await vi.waitFor(() => expect(finishedDownloadFiles(directory)).toEqual([]))

    const nextContents = (session.ensureTab().view as unknown as MockView).webContents
    const replacement = mockDownloadItem({ filename: 'same-name.bin', totalBytes: 100 })
    startMockDownload(nextContents, replacement)
    await vi.waitFor(() => expect(replacement.item.resume).toHaveBeenCalledOnce())
    expect(replacement.item.cancel).not.toHaveBeenCalled()

    first.emitDone('completed')
    second.emitDone('cancelled')
    const concurrent = mockDownloadItem({ filename: 'same-name.bin', totalBytes: 100 })
    startMockDownload(nextContents, concurrent)
    await vi.waitFor(() => expect(concurrent.item.resume).toHaveBeenCalledOnce())
    concurrent.emitDone('completed')
    // The torn-down downloads settling late must not remove the replacement's claimed name.
    await vi.waitFor(() =>
      expect(finishedDownloadFiles(directory)).toEqual([
        expect.stringMatching(/^same-name \(.+\)\.bin$/),
        'same-name.bin',
      ])
    )
    expect(readFileSync(join(directory, 'same-name.bin'), 'utf8')).toBe('')
    replacement.emitDone('completed')
    await vi.waitFor(() =>
      expect(readFileSync(join(directory, 'same-name.bin'), 'utf8')).toBe('same-name.bin')
    )
    await vi.waitFor(() =>
      expect(readdirSync(directory).filter((name) => name.startsWith('.'))).toEqual([])
    )
  })

  it('does not let a cancelled allocation release another download path owner', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sim-browser-downloads-'))
    const firstPathProbe = deferred<boolean>()
    const secondPathProbe = deferred<boolean>()
    const pathExists = vi
      .fn<(path: string) => boolean | Promise<boolean>>()
      .mockReturnValueOnce(firstPathProbe.promise)
      .mockReturnValueOnce(secondPathProbe.promise)
      .mockReturnValue(false)
    session = freshSession(win, {}, undefined, {
      getDirectory: () => directory,
      getFreeDiskBytes: () => Number.MAX_SAFE_INTEGER,
      pathExists,
    })
    const firstContents = session.withBrowserScope(
      'chat-first',
      () => (session.ensureTab().view as unknown as MockView).webContents
    )
    const secondContents = session.withBrowserScope(
      'chat-second',
      () => (session.ensureTab().view as unknown as MockView).webContents
    )
    const thirdContents = session.withBrowserScope(
      'chat-third',
      () => (session.ensureTab().view as unknown as MockView).webContents
    )
    const first = mockDownloadItem({ filename: 'shared.bin', totalBytes: 100 })
    const second = mockDownloadItem({ filename: 'shared.bin', totalBytes: 100 })

    startMockDownload(firstContents, first)
    startMockDownload(secondContents, second)
    firstPathProbe.resolve(false)
    queueMicrotask(() => session.disposeBrowserScope('chat-first'))
    secondPathProbe.resolve(false)

    await vi.waitFor(() => expect(second.item.resume).toHaveBeenCalledOnce())
    expectOnlyStagingSavePath(first.item, directory)
    expect(first.item.resume).not.toHaveBeenCalled()

    const third = mockDownloadItem({ filename: 'shared.bin', totalBytes: 100 })
    startMockDownload(thirdContents, third)
    await vi.waitFor(() => expect(third.item.resume).toHaveBeenCalledOnce())
    third.emitDone('completed')
    await vi.waitFor(() =>
      expect(finishedDownloadFiles(directory)).toEqual([
        expect.stringMatching(/^shared \(.+\)\.bin$/),
        'shared.bin',
      ])
    )
    second.emitDone('completed')
    await vi.waitFor(() =>
      expect(readFileSync(join(directory, 'shared.bin'), 'utf8')).toBe('shared.bin')
    )
  })

  it('cancels only the disposed scope and ignores its late download callbacks', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sim-browser-downloads-'))
    const disposedPathProbe = deferred<boolean>()
    const onDownloadsChanged = vi.fn()
    session = freshSession(win, { onDownloadsChanged }, undefined, {
      getDirectory: () => directory,
      getFreeDiskBytes: () => Number.MAX_SAFE_INTEGER,
      pathExists: (path) =>
        path.endsWith('disposed.bin') ? disposedPathProbe.promise : Promise.resolve(false),
    })
    const disposedContents = session.withBrowserScope(
      'chat-disposed',
      () => (session.ensureTab().view as unknown as MockView).webContents
    )
    const retainedContents = session.withBrowserScope(
      'chat-retained',
      () => (session.ensureTab().view as unknown as MockView).webContents
    )
    const disposedDownload = mockDownloadItem({ filename: 'disposed.bin', totalBytes: 100 })
    const retainedDownload = mockDownloadItem({ filename: 'retained.bin', totalBytes: 100 })

    startMockDownload(disposedContents, disposedDownload)
    startMockDownload(retainedContents, retainedDownload)
    await vi.waitFor(() => expect(retainedDownload.item.resume).toHaveBeenCalledOnce())
    onDownloadsChanged.mockClear()

    session.disposeBrowserScope('chat-disposed')

    expect(disposedDownload.item.cancel).toHaveBeenCalledOnce()
    expect(retainedDownload.item.cancel).not.toHaveBeenCalled()
    disposedPathProbe.resolve(false)
    await Promise.resolve()
    await Promise.resolve()
    disposedDownload.emitUpdated()
    disposedDownload.emitDone('cancelled')

    expectOnlyStagingSavePath(disposedDownload.item, directory)
    expect(disposedDownload.item.resume).not.toHaveBeenCalled()
    expect(session.getBrowserDownloadsState('chat-disposed').downloads).toEqual([])
    expect(onDownloadsChanged).not.toHaveBeenCalledWith(
      expect.objectContaining({ scopeId: 'chat-disposed' })
    )
    retainedDownload.emitUpdated()
    expect(onDownloadsChanged).toHaveBeenCalledWith(
      expect.objectContaining({ scopeId: 'chat-retained' })
    )
  })

  it('bounds active downloads per task and releases the slot on completion', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sim-browser-downloads-'))
    session = freshSession(win, {}, undefined, {
      getDirectory: () => directory,
      getFreeDiskBytes: () => Number.MAX_SAFE_INTEGER,
    })
    const contents = (session.ensureTab().view as unknown as MockView).webContents
    const first = mockDownloadItem({ filename: 'first.txt', totalBytes: 100 })
    const second = mockDownloadItem({ filename: 'second.txt', totalBytes: 100 })
    const rejected = mockDownloadItem({ filename: 'third.txt', totalBytes: 100 })

    startMockDownload(contents, first)
    startMockDownload(contents, second)
    startMockDownload(contents, rejected)
    expect(first.item.cancel).not.toHaveBeenCalled()
    expect(second.item.cancel).not.toHaveBeenCalled()
    expect(rejected.item.cancel).toHaveBeenCalledOnce()

    first.emitDone('completed')
    await vi.waitFor(() =>
      expect(readFileSync(join(directory, 'first.txt'), 'utf8')).toBe('first.txt')
    )
    const replacement = mockDownloadItem({ filename: 'fourth.txt', totalBytes: 100 })
    startMockDownload(contents, replacement)
    expect(replacement.item.cancel).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(replacement.item.resume).toHaveBeenCalledOnce())
  })

  it('does not recreate a disposed scope when a download finishes later', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sim-browser-downloads-'))
    const { persistence, snapshots } = memoryBrowserPersistence()
    session = freshSession(win, {}, persistence, {
      getDirectory: () => directory,
      getFreeDiskBytes: () => Number.MAX_SAFE_INTEGER,
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
      getFilename: vi.fn(() => 'late.txt'),
      getMimeType: vi.fn(() => 'text/plain'),
      getReceivedBytes: vi.fn(() => 4),
      getTotalBytes: vi.fn(() => 4),
      setSavePath: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
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
  let _session: SessionModule

  beforeEach(async () => {
    win = mainWindowMock()
    other = mainWindowMock()
    _session = freshSession(win)
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
  function withCookieJar(
    set: ReturnType<typeof vi.fn>,
    flushStore = vi.fn(async () => {})
  ): SessionModule {
    // The partition is resolved per call, not captured at module load, so
    // re-mocking it here is enough — no module reload required.
    vi.mocked(electronSession.fromPartition).mockReturnValue({
      cookies: { set, flushStore },
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

  it('does not report a durable import when flushing to disk fails', async () => {
    const session = withCookieJar(
      vi.fn(async () => {}),
      vi.fn(async () => {
        throw new Error('Disk unavailable')
      })
    )

    await expect(session.importAgentCookies([cookie('a')])).rejects.toThrow('Disk unavailable')
  })
})

describe('first-party browser sessions', () => {
  const origin = 'https://www.dev.sim.ai'
  function initialize(persistence?: sessionModule.BrowserSessionPersistence) {
    return freshSession(null, {}, persistence, undefined, {
      origin,
      session: new WebContentsView().webContents.session,
    })
  }

  it('keeps a populated tab and its history when crossing the session boundary', () => {
    const session = initialize()
    const tab = session.addAutomationTab(`${origin}/home`)
    const original = tab.view.webContents
    vi.mocked(original.getURL).mockReturnValue(`${origin}/home`)
    const destination = session.tabForNavigation(original, 'https://example.com/', {
      agentOwned: true,
    })
    expect(destination).not.toBe(original)
    expect(agentAppOrigin(destination)).toBeUndefined()
    expect(session.listTabs()).toHaveLength(2)
    expect(original.close).not.toHaveBeenCalled()
    expect(session.navigationTarget(original)).toBe(destination)
    expect(session.automationTab()?.view.webContents).toBe(destination)
    session.recordPageLoadFailure(original, {
      kind: 'load-error',
      code: -2,
      description: 'ERR_FAILED',
      url: 'https://example.com/',
    })
    expect(session.pageIssueForContents(original)).toBeUndefined()
    expect(routeAgentNavigation(original, `${origin}/home`)).toBe(false)
    expect(session.navigationTarget(original)).toBe(original)
  })

  it('does not replay cross-session form submissions as GET requests', () => {
    const session = initialize()
    const tab = session.addAutomationTab(`${origin}/home`)
    const contents = tab.view.webContents
    expect(routeAgentNavigation(contents, 'https://example.com/submit', 'POST')).toBe(true)
    expect(session.listTabs()).toHaveLength(1)
    expect(contents.loadURL).not.toHaveBeenCalled()
    expect(routeAgentNavigation(contents, `${origin}/submit`, 'POST')).toBe(false)
  })
})
