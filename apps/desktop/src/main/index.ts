import { join, resolve } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { OpenDialogOptions, Session, WebContents } from 'electron'
import { app, BrowserWindow, crashReporter, dialog, net, session, shell } from 'electron'
import {
  beginAccountDataTeardown,
  completeDeploymentScopedTeardown,
  getAccountDataTeardownKind,
  initializeAccountDataRecovery,
  isAccountDataTeardownRequired,
  prepareAccountDataTeardownForQuit,
  retryAccountDataTeardown,
  waitForAccountDataMutations,
} from '@/main/account-data-generation'
import { newChatRoute, settingsRoute } from '@/main/app-routes'
import {
  activateBrowserScope as activateAgentBrowserScope,
  clearBrowserProfile as clearAgentBrowserProfile,
  initDriver as initBrowserAgentDriver,
} from '@/main/browser-agent/driver'
import {
  canReportPanelBounds,
  capturePanelSnapshot as captureBrowserAgentPanelSnapshot,
  setPanelBounds as setBrowserAgentPanelBounds,
  setPanelOccluded as setBrowserAgentPanelOccluded,
} from '@/main/browser-agent/panel'
import {
  closeSession as closeAgentBrowserSession,
  handleFocusedShortcut as handleFocusedBrowserShortcut,
  isBrowserScopeSuspended,
  quiesceBrowserSessions,
  setBrowserDefaultZoom as setAgentBrowserDefaultZoom,
  setBrowserAppearanceTheme as setAgentBrowserTheme,
  setPanelFocused as setBrowserAgentPanelFocused,
} from '@/main/browser-agent/session'
import {
  APP_NAME_FOR_CHANNEL,
  channelForOrigin,
  createConfigStore,
  DEFAULT_ORIGIN,
  isSafeInternalPath,
  partitionForOrigin,
} from '@/main/config'
import { attachContextMenu } from '@/main/context-menu'
import { attachCspFallback } from '@/main/csp'
import { DesktopChatSessionStore } from '@/main/desktop-chat-session-store'
import { createDesktopSettingsService } from '@/main/desktop-settings'
import { attachDownloadHandling } from '@/main/downloads'
import { createAuthFlow, createConnectFlow, createHandoffManager } from '@/main/handoff'
import {
  installDocumentationHelpSearch,
  uninstallDocumentationHelpSearch,
} from '@/main/help-search'
import { registerIpcHandlers } from '@/main/ipc'
import { attachLoadHealth, type LoadHealthHandle } from '@/main/load-health'
import { LocalFilesystemService } from '@/main/local-filesystem'
import { createEncryptedLocalFilesystemGrantStore } from '@/main/local-filesystem-grant-store'
import { installApplicationMenu } from '@/main/menu'
import { openExternalSafe } from '@/main/navigation'
import { createEventLog, installMainProcessFailureObservers } from '@/main/observability'
import { ScopedEventRouter } from '@/main/scoped-event-router'
import { installGlobalGuards } from '@/main/security-guards'
import { createServerWindow, relaunchApp } from '@/main/server-window'
import {
  canRevokeIn,
  createSessionLifecycleCoordinator,
  decideStartRoute,
  handleConnectIntercept,
  readSessionUserId,
  resolveStartRoute,
} from '@/main/session-lifecycle'
import { attachTelemetryPolicy } from '@/main/telemetry-policy'
import { TerminalRegistry } from '@/main/terminal/registry'
import { installTray, type TrayHandle } from '@/main/tray'
import { checkForUpdatesInteractive, initUpdater, type UpdaterHandle } from '@/main/updater'
import { createMainWindow, setupPermissionHandlers } from '@/main/window'
import { attachWindowOpenPolicy, isPopupContents } from '@/main/windows'

const logger = createLogger('DesktopMain')

/**
 * Backstop for the sign-in flows, which are dispatched fire-and-forget from a
 * loopback callback and a navigation guard. The flows record their own expected
 * failures; this catches anything they do not, so a rejection cannot surface as
 * an unhandled one — the process-level observer is a last-resort restart path,
 * not routine control flow.
 */
function reportHandoffFailure(error: unknown): void {
  logger.error('Sign-in handoff failed', { error: getErrorMessage(error) })
}

const OFFLINE_PAGE = 'static/offline.html'
const SERVER_PAGE = 'static/server.html'
const DOCK_ICON_FOR_CHANNEL = {
  prod: 'dock-icon.png',
  staging: 'dock-icon-staging.png',
  dev: 'dock-icon-dev.png',
  local: 'dock-icon-local.png',
} as const

function main(): void {
  app.enableSandbox()

  const userDataPath = app.getPath('userData')
  const config = createConfigStore(join(userDataPath, 'settings.json'))
  initializeAccountDataRecovery(join(userDataPath, 'account-data-teardown-required.json'))
  const accountDataAvailable = () =>
    config.isPersistenceAvailable() && !isAccountDataTeardownRequired()
  const events = createEventLog(join(userDataPath, 'logs'))
  const appOrigin = () => config.getOrigin()
  /** Resource snapshots stay with the deployment that created this process. */
  const processOrigin = appOrigin()
  const recoveryPartition = `sim-settings-recovery-${process.pid}`
  const appPartition = (origin = appOrigin()) =>
    accountDataAvailable() ? partitionForOrigin(origin) : recoveryPartition
  const desktopChatSessions = new DesktopChatSessionStore(
    join(userDataPath, 'desktop-chat-sessions.json')
  )
  const clearDesktopChatSessions = (): void => {
    desktopChatSessions.clear()
  }
  const flushDesktopChatSessions = (phase: 'before-quit' | 'will-quit'): void => {
    if (!desktopChatSessions.flush()) {
      logger.warn('Could not flush encrypted task resource state', { phase })
    }
  }
  const localFilesystem = new LocalFilesystemService({
    grantStore: createEncryptedLocalFilesystemGrantStore(
      join(userDataPath, 'local-filesystem-grants.json')
    ),
  })
  const scopeEvents = new ScopedEventRouter()
  const terminal = new TerminalRegistry({
    load: (scopeId) => desktopChatSessions.getTerminal(processOrigin, scopeId) ?? undefined,
    save: (scopeId, snapshot) => desktopChatSessions.setTerminal(processOrigin, scopeId, snapshot),
    migrate: (fromScopeId, toScopeId) =>
      desktopChatSessions.migrateTerminal(processOrigin, fromScopeId, toScopeId),
    disposeScope: (scopeId) => {
      desktopChatSessions.deleteScope(processOrigin, scopeId)
    },
  })
  const preloadPath = join(__dirname, 'preload.cjs')

  const windows = new Set<BrowserWindow>()
  const loadHealthByWindow = new Map<BrowserWindow, LoadHealthHandle>()
  let lastActiveWindow: BrowserWindow | null = null
  let ensureWindowCreation: Promise<BrowserWindow> | null = null
  let appSession: Session | null = null
  let sessionLifecycle: ReturnType<typeof createSessionLifecycleCoordinator> | null = null
  let resumingQuitAfterTeardown = false
  let tray: TrayHandle | null = null
  let updater: UpdaterHandle | null = null
  let startupReady: Promise<void> | null = null
  const configuredPartitions = new Set<string>()

  const allowHttpLocalhost = () => !app.isPackaged || appOrigin().startsWith('http://')
  const getWindows = () => [...windows].filter((win) => !win.isDestroyed())
  const getMainWindow = () => {
    const focused = BrowserWindow.getFocusedWindow()
    if (focused && windows.has(focused) && !focused.isDestroyed()) {
      return focused
    }
    if (lastActiveWindow && windows.has(lastActiveWindow) && !lastActiveWindow.isDestroyed()) {
      return lastActiveWindow
    }
    return getWindows().at(-1) ?? null
  }
  installMainProcessFailureObservers({ events, getWindow: getMainWindow })
  const windowForContents = (contents: WebContents) => {
    const win = BrowserWindow.fromWebContents(contents)
    return win && windows.has(win) && !win.isDestroyed() ? win : null
  }
  /** The focused window, but only when it is one of ours. */
  const focusedAppWindow = () => {
    const focused = BrowserWindow.getFocusedWindow()
    return focused && windows.has(focused) && !focused.isDestroyed() ? focused : null
  }
  const broadcast = (channel: string, ...args: unknown[]) => {
    for (const win of getWindows()) {
      win.webContents.send(channel, ...args)
    }
  }

  /** Restore/show/focus one full Sim window and activate the app. */
  function showMainWindow(target?: BrowserWindow | null): void {
    const win = target ?? getMainWindow()
    if (win) {
      if (win.isMinimized()) {
        win.restore()
      }
      win.show()
      win.focus()
    }
    app.focus({ steal: true })
  }

  const handoff = createHandoffManager(
    {
      origin: appOrigin,
      openExternal: (url) => openExternalSafe(url, allowHttpLocalhost()),
      events,
      currentUserId: () => readSessionUserId(ensureAppSession(), appOrigin()),
    },
    {
      onLogin: (callback) => void authFlow.handleCallback(callback).catch(reportHandoffFailure),
      onConnect: (callback) => connectFlow.handleCallback(callback),
    }
  )

  const authFlow = createAuthFlow({
    handoff,
    origin: appOrigin,
    events,
    ensureMainWindow: async () => {
      let win = getMainWindow()
      if (!win) {
        win = await ensureMainWindow()
      }
      if (!win) {
        throw new Error('Main window unavailable')
      }
      return win
    },
  })

  const connectFlow = createConnectFlow({
    handoff,
    events,
    focusMainWindow: showMainWindow,
    notifyRenderer: (result) => {
      broadcast('desktop:oauth-connect-complete', result)
    },
  })

  installGlobalGuards({
    appOrigin,
    isPackaged: app.isPackaged,
    allowHttpLocalhost,
    isPopupContents,
    onLoginHandoff: () => void authFlow.beginLoginHandoff().catch(reportHandoffFailure),
    onConnectIntercept: (contents) => void handleConnectIntercept(contents, allowHttpLocalhost()),
  })

  function configureSessionForOrigin(origin: string) {
    const partition = appPartition(origin)
    const ses = session.fromPartition(partition)
    if (configuredPartitions.has(partition)) {
      return ses
    }
    configuredPartitions.add(partition)
    setupPermissionHandlers(ses, appOrigin)
    attachCspFallback(ses, appOrigin)
    attachDownloadHandling(ses, events)
    attachTelemetryPolicy(ses, config.get('blockThirdPartyAnalytics') ?? true)
    ses.setSpellCheckerLanguages(['en-US'])
    return ses
  }

  function ensureAppSession(): Session {
    if (appSession && sessionLifecycle) return appSession
    const ses = configureSessionForOrigin(appOrigin())
    appSession = ses
    sessionLifecycle = createSessionLifecycleCoordinator({
      appSession: ses,
      origin: appOrigin,
      events,
      getWindows,
      clearHandoffState: async () => {
        const stores = [
          { label: 'sign-in handoff state', clear: () => handoff.clear() },
          { label: 'recent tasks', clear: () => tray?.clearRecentChats() },
          {
            label: 'renderer session state',
            clear: () =>
              Promise.all(
                getWindows()
                  .filter((win) => canRevokeIn(win, appOrigin()))
                  .map((win) =>
                    win.webContents.executeJavaScript(
                      `(() => { sessionStorage.clear(); window.name = '' })()`,
                      true
                    )
                  )
              ).then(() => undefined),
          },
          // Shells are account-scoped runtime state. Leaving them alive across
          // sign-out would stream the previous account's output into the next
          // renderer and keep its local processes running invisibly.
          { label: 'terminal sessions', clear: () => terminal.dispose() },
          { label: 'task resource state', clear: clearDesktopChatSessions },
          { label: 'local filesystem grants', clear: () => localFilesystem.forgetAll() },
        ]
        const outcomes = await Promise.allSettled(
          stores.map(({ clear }) => Promise.resolve().then(clear))
        )
        const failures = outcomes.flatMap((outcome, index) => {
          if (outcome.status === 'fulfilled') return []
          logger.error('Could not clear local account state', {
            store: stores[index].label,
            error: getErrorMessage(outcome.reason),
          })
          return [outcome.reason]
        })
        if (failures.length > 0) {
          throw new AggregateError(failures, 'Local account state survived teardown.')
        }
      },
      clearBrowserProfile: async () => {
        // Browser profile teardown emits empty tab snapshots while closing its
        // live views. Clear task descriptors afterward so those snapshots
        // cannot recreate account-scoped state after sign-out.
        const failures: unknown[] = []
        await clearAgentBrowserProfile().catch((error) => failures.push(error))
        try {
          clearDesktopChatSessions()
        } catch (error) {
          failures.push(error)
        }
        if (failures.length > 0) {
          throw new AggregateError(failures, 'Browser account state survived teardown.')
        }
      },
    })
    return ses
  }

  async function ensureMainWindow(): Promise<BrowserWindow> {
    const existing = getMainWindow()
    if (existing) return existing
    if (ensureWindowCreation) return ensureWindowCreation

    const pending = createAndLoadAppWindow({ restorePosition: true })
    ensureWindowCreation = pending
    try {
      return await pending
    } finally {
      if (ensureWindowCreation === pending) {
        ensureWindowCreation = null
      }
    }
  }

  function routeFromAppUrl(rawUrl: string): string | null {
    try {
      const url = new URL(rawUrl)
      if (url.origin !== appOrigin()) return null
      const route = `${url.pathname}${url.search}${url.hash}`
      return isSafeInternalPath(route) ? route : null
    } catch {
      return null
    }
  }

  async function createAndLoadAppWindow({
    route: requestedRouteOverride,
    restorePosition = false,
  }: {
    route?: string
    restorePosition?: boolean
  } = {}): Promise<BrowserWindow> {
    const origin = appOrigin()
    const ses = ensureAppSession()
    const requestedRoute = decideStartRoute(requestedRouteOverride ?? config.get('lastRoute'))
    const route = await resolveStartRoute(ses, origin, requestedRoute)
    if (route !== requestedRoute) {
      config.set('lastRoute', route)
    }
    const win = createMainWindow({
      config,
      events,
      appOrigin,
      partition: appPartition(origin),
      preloadPath,
      isPackaged: app.isPackaged,
      restorePosition,
      onFullScreenChange: (isFullScreen) => {
        if (!win.isDestroyed()) {
          win.webContents.send('desktop:window-state:changed', { isFullScreen })
        }
      },
      onClosed: () => {
        setBrowserAgentPanelBounds(null, win)
        windows.delete(win)
        loadHealthByWindow.delete(win)
        if (lastActiveWindow === win) {
          lastActiveWindow = getWindows().at(-1) ?? null
        }
      },
    })
    windows.add(win)
    lastActiveWindow = win
    win.on('focus', () => {
      lastActiveWindow = win
    })
    // A fresh document (reload, origin change, crash recovery) has no browser
    // panel mounted yet — hide the embedded agent-browser view immediately
    // rather than letting it linger over the loading page.
    win.webContents.on('did-start-loading', () => {
      setBrowserAgentPanelBounds(null, win)
    })
    attachWindowOpenPolicy(win.webContents, {
      appOrigin,
      openAppWindow: (url) => {
        const route = routeFromAppUrl(url)
        if (route) {
          void createAndLoadAppWindow({ route })
        }
      },
      allowHttpLocalhost: allowHttpLocalhost(),
    })
    attachContextMenu(win.webContents, {
      isDev: !app.isPackaged,
      allowHttpLocalhost: allowHttpLocalhost(),
    })
    const loadHealth = attachLoadHealth(win, {
      offlinePagePath: OFFLINE_PAGE,
      getStartUrl: () => `${appOrigin()}${route}`,
      isOnline: () => net.isOnline(),
      events,
    })
    loadHealthByWindow.set(win, loadHealth)
    sessionLifecycle?.attachWindow(win)
    loadHealth.startWatchdog()
    // Fire-and-forget: the window and all its handlers are wired synchronously
    // above, so callers get a usable window immediately and the app menu and
    // updater never wait on the remote page's load (load-health surfaces any
    // failure).
    void win.loadURL(`${origin}${route}`).catch(() => {})
    return win
  }

  /** Opens the Sim app's settings page in the active window. */
  function openSettings(): void {
    void openMainWindowAt(settingsRoute(config.get('lastRoute')))
  }

  /**
   * Brings the active window to front (creating one if needed), optionally
   * navigating it to an in-app route first — the seam used by the tray menu.
   */
  async function openMainWindowAt(route?: string): Promise<void> {
    let win = getMainWindow()
    if (!win) {
      win = await createAndLoadAppWindow({ route, restorePosition: true })
      showMainWindow(win)
      return
    }
    if (route) {
      void win.loadURL(`${appOrigin()}${route}`).catch(() => {})
    }
    showMainWindow(win)
  }

  /** Installs or removes the menu-bar status item; safe to call repeatedly. */
  function setTrayEnabled(enabled: boolean): void {
    if (!enabled) {
      tray?.destroy()
      tray = null
      return
    }
    if (!tray) {
      tray = installTray({
        partition: appPartition,
        appOrigin,
        lastRoute: () => config.get('lastRoute'),
        openMainWindow: (route) => void openMainWindowAt(route),
      })
    }
  }

  const desktopSettings = createDesktopSettingsService({
    config,
    getMainWindow,
    openMainWindowAt: (route) => void openMainWindowAt(route),
    setAutoDownloadUpdates: (enabled) => updater?.setAutoDownload(enabled),
    setTrayEnabled,
    // Switching a surface off ends what it is already running; the pages and
    // shells would otherwise keep going in the background. The profile and the
    // pinned strip survive, so switching back on resumes rather than restarts.
    setBrowserEnabled: (enabled) => {
      if (!enabled) closeAgentBrowserSession()
    },
    setTerminalEnabled: (enabled) => {
      if (!enabled) terminal.dispose()
    },
    setBrowserTheme: setAgentBrowserTheme,
    setBrowserDefaultZoom: setAgentBrowserDefaultZoom,
    setTerminalDefaultZoom: (zoom) => {
      broadcast('terminal:default-zoom-changed', zoom)
    },
    onBrowserThemeChanged: (theme) => {
      const win = getMainWindow()
      if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
      win.webContents.send('browser-agent:appearance-theme-changed', theme)
    },
    getDefaultBrowserDownloadDirectory: () => app.getPath('downloads'),
    chooseBrowserDownloadDirectory: async (defaultPath) => {
      const options: OpenDialogOptions = {
        title: 'Choose Browser Downloads Folder',
        buttonLabel: 'Choose',
        defaultPath,
        properties: ['openDirectory', 'createDirectory'],
      }
      const win = getMainWindow()
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
  })

  const serverWindow = createServerWindow({
    config,
    defaultOrigin: DEFAULT_ORIGIN,
    pagePath: SERVER_PAGE,
    preloadPath,
    isPackaged: app.isPackaged,
    getParentWindow: getMainWindow,
    clearDeploymentScopedState: async () => {
      beginAccountDataTeardown('deployment')
      await waitForAccountDataMutations()
      // allSettled, not sequential awaits: these are independent stores, and a
      // rejection from the first must not skip the second — leaving the store
      // that would have cleared fine still holding the outgoing deployment's
      // access. Each failure is named so the picker can say what survived.
      const stores = [
        { label: 'local file access', clear: () => localFilesystem.forgetAll() },
        {
          label: 'built-in browser sessions',
          clear: () => clearAgentBrowserProfile({ settingsPersistence: 'server-repair' }),
        },
      ]
      const outcomes = await Promise.allSettled(stores.map((store) => store.clear()))
      return outcomes.flatMap((outcome, index) => {
        if (outcome.status === 'fulfilled') return []
        logger.error('Could not clear deployment-scoped state', {
          store: stores[index].label,
          error: getErrorMessage(outcome.reason),
        })
        return [stores[index].label]
      })
    },
    canCompleteDeploymentScopedStateChange: () => getAccountDataTeardownKind() === 'deployment',
    completeDeploymentScopedStateChange: completeDeploymentScopedTeardown,
    relaunch: relaunchApp,
  })

  /**
   * Routes through the coordinator rather than tearing down directly: the
   * coordinator holds the in-progress guard, clears the same handoff and grant
   * state, and reloads every window to /login. Doing it here instead meant the
   * teardown's own cookie removal tripped the coordinator's cookie watcher into
   * a second concurrent teardown.
   */
  function signOutFromMenu(): void {
    ensureAppSession()
    void sessionLifecycle?.signOut()
  }

  app.on('second-instance', () => {
    void (startupReady ?? app.whenReady()).then(() => createAndLoadAppWindow())
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', (event) => {
    if (!resumingQuitAfterTeardown && sessionLifecycle?.isTeardownActive()) {
      event.preventDefault()
      void sessionLifecycle.awaitTeardown().then((clean) => {
        if (!clean) {
          logger.error('Quit cancelled because account teardown did not finish safely')
          return
        }
        resumingQuitAfterTeardown = true
        app.quit()
      })
      return
    }
    if (!prepareAccountDataTeardownForQuit()) {
      event.preventDefault()
      logger.error('Quit cancelled because account-data recovery could not be persisted')
      return
    }
    // Stops the tray's background chat refresh alongside the OS handles.
    tray?.destroy()
    tray = null
    localFilesystem.close()
    // Quiesce native pages before publishing the final encrypted descriptor
    // set. This prevents a navigation event racing the synchronous quit flush.
    quiesceBrowserSessions()
    terminal.dispose()
    uninstallDocumentationHelpSearch()
    flushDesktopChatSessions('before-quit')
    // Settings writes coalesce, so a change made in the last moments before
    // quit is still pending here.
    config.flush()
  })

  app.on('will-quit', () => {
    // Final backstop for any descriptor dirtied while Electron was closing
    // windows after before-quit.
    flushDesktopChatSessions('will-quit')
  })

  app.on('activate', () => {
    if (!app.isReady()) return
    void (startupReady ?? app.whenReady()).then(() => {
      if (!getMainWindow()) return ensureMainWindow()
    })
  })

  startupReady = app.whenReady().then(async () => {
    // Packaged apps keep their native bundle icon so the Dock appearance does
    // not change when the process starts. Unpackaged runs have no branded
    // bundle, so they still need the channel-specific development icon.
    if (process.platform === 'darwin' && !app.isPackaged) {
      const channel = channelForOrigin(config.getOrigin())
      app.dock?.setIcon(join(__dirname, '..', 'static', DOCK_ICON_FOR_CHANNEL[channel]))
    }
    events.record('app_launch', {
      version: app.getVersion(),
      electron: process.versions.electron ?? '',
    })

    if (isAccountDataTeardownRequired() && config.isPersistenceAvailable()) {
      const kind = getAccountDataTeardownKind()
      const stores = [
        { label: 'built-in browser sessions', clear: () => clearAgentBrowserProfile() },
        { label: 'local filesystem grants', clear: () => localFilesystem.forgetAll() },
        {
          label: 'browser site history',
          clear: () => {
            config.set('browserKnownSites', undefined)
            if (!config.flush()) throw new Error('Browser site history could not be erased')
          },
        },
        ...(kind === 'account'
          ? [
              { label: 'sign-in handoff state', clear: () => handoff.clear() },
              { label: 'terminal sessions', clear: () => terminal.dispose() },
              { label: 'task resource state', clear: clearDesktopChatSessions },
              {
                label: 'app session storage',
                clear: async () => {
                  const persistedSession = session.fromPartition(partitionForOrigin(appOrigin()))
                  await persistedSession.clearStorageData()
                  await persistedSession.clearCache()
                },
              },
            ]
          : []),
      ]
      const failures = await retryAccountDataTeardown(stores).catch((error) => {
        logger.error('Could not finish interrupted account-data teardown', {
          error: getErrorMessage(error),
        })
        return ['account-data recovery marker']
      })
      if (failures.length > 0) {
        logger.error('Account-data recovery remains incomplete', { stores: failures })
      }
    }

    if (!accountDataAvailable()) {
      logger.warn(
        'Account-bearing browser, terminal, and local filesystem APIs are unavailable until local recovery succeeds'
      )
    } else if (!desktopChatSessions.initialize()) {
      logger.warn(
        'Encrypted task resource storage is unavailable; browser and terminal state will remain memory-only'
      )
    }
    initBrowserAgentDriver(
      {
        onPageState: (state) => {
          scopeEvents.sendBrowser(state.scopeId, 'browser-agent:page-state', state)
        },
        onTabsState: (state) => {
          scopeEvents.sendBrowser(state.scopeId, 'browser-agent:tabs-state', state)
        },
        onSessionStatus: (alive, scopeId) => {
          scopeEvents.sendBrowser(scopeId, 'browser-agent:session-status', alive, scopeId)
        },
        onFillAvailability: (available, scopeId) => {
          scopeEvents.sendBrowser(scopeId, 'browser-credentials:fill-availability', {
            available,
            scopeId,
          })
        },
        onDownloadsChanged: (state) => {
          scopeEvents.sendBrowser(state.scopeId, 'browser-agent:downloads-state', state)
        },
      },
      getMainWindow,
      config,
      {
        load: (scopeId) => desktopChatSessions.getBrowser(processOrigin, scopeId),
        save: (scopeId, snapshot) =>
          desktopChatSessions.setBrowser(processOrigin, scopeId, snapshot),
        migrateScope: (fromScopeId, toScopeId) =>
          desktopChatSessions.migrateBrowser(processOrigin, fromScopeId, toScopeId),
        disposeScope: (scopeId) => {
          desktopChatSessions.deleteScope(processOrigin, scopeId)
        },
      },
      {
        getDirectory: () => desktopSettings.getPreferences().browserDownloadDirectory,
      }
    )
    if (accountDataAvailable()) {
      await localFilesystem.initialize()
    }
    terminal.setSink({
      data: (scopeId, terminalId, data) =>
        scopeEvents.sendTerminal(scopeId, 'terminal:data', terminalId, data, scopeId),
      tabs: (scopeId, state) =>
        scopeEvents.sendTerminal(scopeId, 'terminal:tabs', { ...state, scopeId }),
      command: (scopeId, event) =>
        scopeEvents.sendTerminal(scopeId, 'terminal:command', { ...event, scopeId }),
    })
    registerIpcHandlers({
      appOrigin,
      allowHttpLocalhost,
      accountDataAvailable,
      localPagePaths: [resolve(OFFLINE_PAGE), resolve(SERVER_PAGE)],
      scopeEvents,
      retryLoad: (sender) => {
        const win = windowForContents(sender)
        if (win) loadHealthByWindow.get(win)?.retry()
      },
      localFilesystem,
      terminal,
      settings: desktopSettings,
      getWindowState: (sender) => ({
        isFullScreen: windowForContents(sender)?.isFullScreen() ?? false,
      }),
      getWindowForContents: (sender) => windowForContents(sender) ?? null,
      browserPanel: {
        activateScope: (sender, scopeId) => {
          const win = windowForContents(sender)
          if (win && focusedAppWindow() === win) {
            activateAgentBrowserScope(scopeId)
          }
        },
        setBounds: (sender, bounds, anchor, scopeId) => {
          const win = windowForContents(sender)
          if (!win) return
          // A second window can keep reporting its old panel rect after this
          // task was soft-deleted elsewhere. Bounds are a heartbeat, not a
          // task-open signal, so they must never clear the suspension
          // tombstone and recreate the closed WebContents.
          if (bounds !== null && isBrowserScopeSuspended(scopeId)) return
          // A window may have become focused without its chat changing, so no
          // renderer activation effect reran. Its live bounds lease is the
          // authoritative signal to move the singleton compositor now.
          if (bounds !== null && focusedAppWindow() === win) {
            activateAgentBrowserScope(scopeId)
          }
          if (bounds !== null && !canReportPanelBounds(win, focusedAppWindow(), scopeId)) {
            return
          }
          setBrowserAgentPanelBounds(bounds, win, anchor, scopeId)
        },
        setFocused: (sender, focused, scopeId) => {
          const win = windowForContents(sender)
          if (win) setBrowserAgentPanelFocused(focused, win, scopeId)
        },
        captureSnapshot: (sender, scopeId) => {
          const win = windowForContents(sender)
          return win ? captureBrowserAgentPanelSnapshot(win, scopeId) : Promise.resolve(null)
        },
        setOccluded: (sender, occluded, scopeId, force) => {
          const win = windowForContents(sender)
          if (!win) return false
          // A modal in a stale renderer must not resurrect a soft-deleted
          // Browser scope. There is no local native surface for that scope;
          // acknowledge only its forced hide/any reveal as scoped no-ops.
          if (isBrowserScopeSuspended(scopeId)) return !occluded || force === true
          // The focused window may open a modal before its next bounds frame
          // has transferred the singleton Browser from another app window.
          // Move the session scope first so the forced hide establishes the
          // new owner's hidden lease, rather than acknowledging a background
          // no-op and then attaching the view visibly on the bounds report.
          const resolvedScopeId =
            occluded && force && focusedAppWindow() === win
              ? activateAgentBrowserScope(scopeId)
              : scopeId
          return setBrowserAgentPanelOccluded(occluded, win, resolvedScopeId, force)
        },
      },
      beginOAuthConnect: (providerId, scope) => connectFlow.beginConnectHandoff(providerId, scope),
      updates: {
        getState: () => updater?.getState() ?? { status: 'idle' },
        check: () => updater?.check(),
        install: () => updater?.install(),
      },
      server: {
        open: () => serverWindow.open(),
        getConfiguration: () => serverWindow.getConfiguration(),
        setOrigin: (origin) => serverWindow.setOrigin(origin),
      },
    })
    await ensureMainWindow()
    installApplicationMenu({
      config,
      getMainWindow,
      isMainWindow: (win) => windows.has(win) && !win.isDestroyed(),
      allowHttpLocalhost,
      openSettings,
      openServerSettings: () => serverWindow.open(),
      newWindow: () => void createAndLoadAppWindow(),
      newChat: () => void openMainWindowAt(newChatRoute(config.get('lastRoute'))),
      handleFocusedResourceShortcut: (win, shortcut) =>
        handleFocusedBrowserShortcut(shortcut, win) ||
        terminal.handleFocusedShortcut(win, shortcut),
      toggleSidebar: () => getMainWindow()?.webContents.send('desktop:command', 'toggle-sidebar'),
      openSearch: () => getMainWindow()?.webContents.send('desktop:command', 'open-search'),
      signOut: signOutFromMenu,
      checkForUpdates: () =>
        checkForUpdatesInteractive({ getWindow: getMainWindow, events, handle: updater }),
      openDiagnostics: () => shell.showItemInFolder(events.filePath),
    })
    installDocumentationHelpSearch()
    setTrayEnabled(config.get('trayEnabled') ?? true)
    updater = initUpdater({
      getWindow: getMainWindow,
      events,
      appOrigin,
      autoDownload: () => config.get('autoDownloadUpdates') ?? true,
      beforeInstall: async () => {
        if (!prepareAccountDataTeardownForQuit()) {
          throw new Error(
            'Account-data recovery could not be persisted before update installation.'
          )
        }
        if (sessionLifecycle && !(await sessionLifecycle.awaitTeardown())) {
          throw new Error('Account teardown did not finish safely before update installation.')
        }
      },
      onStateChange: (state) => {
        broadcast('desktop:updates:state', state)
      },
    })
    desktopSettings.applySystemPreferences()
  })
}

// Identity and userData must be set before the single-process lock, which
// writes its lock file into userData. Sim supports many full BrowserWindows
// inside that one process; a second OS launch is forwarded to the running
// process so it can create another window without two processes mutating the
// same Chromium profile. Setting identity here (not inside main) keeps the
// SIM_DESKTOP_ORIGIN/USER_DATA test overrides isolated per process.
// The name follows the build's channel ("Sim", "Sim Dev", …) so one developer
// can run one install per environment side by side — separate settings,
// sessions, locks, and update feeds.
app.setName(APP_NAME_FOR_CHANNEL[channelForOrigin(DEFAULT_ORIGIN)])
if (process.env.SIM_DESKTOP_USER_DATA) {
  app.setPath('userData', process.env.SIM_DESKTOP_USER_DATA)
}

// Capture native minidumps for main/renderer/GPU crashes. Local-only: there is
// no crash-ingest backend, so nothing is uploaded — the dumps land under
// userData/Crashpad and the event log records where. Must start before the app
// is ready so Crashpad initializes first. Set after userData so dumps follow
// any test/instance override.
crashReporter.start({ uploadToServer: false, compress: true })

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  main()
}
