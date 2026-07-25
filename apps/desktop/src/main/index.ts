import { join } from 'node:path'
import { createLogger } from '@sim/logger'
import type { Session, WebContents } from 'electron'
import { app, BrowserWindow, crashReporter, net, session } from 'electron'
import {
  clearBrowserProfile as clearAgentBrowserProfile,
  initDriver as initBrowserAgentDriver,
} from '@/main/browser-agent/driver'
import {
  canReportPanelBounds,
  setPanelBounds as setBrowserAgentPanelBounds,
  setPanelOccluded as setBrowserAgentPanelOccluded,
} from '@/main/browser-agent/panel'
import {
  closeFocusedTab as closeFocusedBrowserTab,
  reopenFocusedTab as reopenClosedBrowserTab,
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
import { createDesktopSettingsService } from '@/main/desktop-settings'
import { attachDownloadHandling } from '@/main/downloads'
import { createAuthFlow, createConnectFlow, createHandoffManager } from '@/main/handoff'
import { registerIpcHandlers } from '@/main/ipc'
import { attachLoadHealth, type LoadHealthHandle } from '@/main/load-health'
import { LocalFilesystemService } from '@/main/local-filesystem'
import { createEncryptedLocalFilesystemGrantStore } from '@/main/local-filesystem-grant-store'
import { installApplicationMenu } from '@/main/menu'
import { openExternalSafe } from '@/main/navigation'
import { createEventLog } from '@/main/observability'
import { installGlobalGuards } from '@/main/security-guards'
import {
  createSessionLifecycleCoordinator,
  decideStartRoute,
  handleConnectIntercept,
  resolveStartRoute,
} from '@/main/session-lifecycle'
import { attachTelemetryPolicy } from '@/main/telemetry-policy'
import { TerminalService } from '@/main/terminal'
import { installTray, newChatRoute, settingsRoute, type TrayHandle } from '@/main/tray'
import { checkForUpdatesInteractive, initUpdater, type UpdaterHandle } from '@/main/updater'
import { createMainWindow, setupPermissionHandlers } from '@/main/window'
import { attachWindowOpenPolicy, isPopupContents } from '@/main/windows'

const logger = createLogger('DesktopMain')

const OFFLINE_PAGE = 'static/offline.html'
const DOCK_ICON_FOR_CHANNEL = {
  prod: 'dock-icon.png',
  staging: 'dock-icon-staging.png',
  dev: 'dock-icon-dev.png',
  local: 'dock-icon-local.png',
} as const

function main(): void {
  app.enableSandbox()

  const config = createConfigStore(join(app.getPath('userData'), 'settings.json'))
  const events = createEventLog(join(app.getPath('userData'), 'logs'))
  const localFilesystem = new LocalFilesystemService({
    grantStore: createEncryptedLocalFilesystemGrantStore(
      join(app.getPath('userData'), 'local-filesystem-grants.json')
    ),
  })
  const terminal = new TerminalService({
    loadCwd: () => config.get('terminalCwd'),
    saveCwd: (cwd) => config.set('terminalCwd', cwd),
  })
  const preloadPath = join(__dirname, 'preload.cjs')

  const windows = new Set<BrowserWindow>()
  const loadHealthByWindow = new Map<BrowserWindow, LoadHealthHandle>()
  let lastActiveWindow: BrowserWindow | null = null
  let ensureWindowCreation: Promise<BrowserWindow> | null = null
  let appSession: Session | null = null
  let sessionLifecycle: ReturnType<typeof createSessionLifecycleCoordinator> | null = null
  let tray: TrayHandle | null = null
  let updater: UpdaterHandle | null = null
  const configuredPartitions = new Set<string>()

  const appOrigin = () => config.getOrigin()
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
    },
    {
      onLogin: (callback) => void authFlow.handleCallback(callback),
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
    onLoginHandoff: () => void authFlow.beginLoginHandoff(),
    onConnectIntercept: (contents) => void handleConnectIntercept(contents, allowHttpLocalhost()),
  })

  function configureSessionForOrigin(origin: string) {
    const partition = partitionForOrigin(origin)
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
        handoff.clear()
        await localFilesystem.forgetAll()
      },
      clearBrowserProfile: clearAgentBrowserProfile,
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
      partition: partitionForOrigin(origin),
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
        partition: () => partitionForOrigin(appOrigin()),
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
    sessionLifecycle?.signOut()
  }

  app.on('second-instance', () => {
    void app.whenReady().then(() => createAndLoadAppWindow())
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', () => {
    // Stops the tray's background chat refresh alongside the OS handles.
    tray?.destroy()
    tray = null
    localFilesystem.close()
    terminal.dispose()
  })

  app.on('activate', () => {
    if (app.isReady() && !getMainWindow()) {
      void ensureMainWindow()
    }
  })

  void app.whenReady().then(async () => {
    // Unpackaged runs show Electron's default Dock icon (the packaged icns
    // only applies to built apps), so use the active origin's icon at runtime.
    if (!app.isPackaged && process.platform === 'darwin') {
      const channel = channelForOrigin(config.getOrigin())
      app.dock?.setIcon(join(__dirname, '..', 'static', DOCK_ICON_FOR_CHANNEL[channel]))
    }
    events.record('app_launch', {
      version: app.getVersion(),
      electron: process.versions.electron ?? '',
    })
    initBrowserAgentDriver(
      {
        onPageState: (state) => {
          broadcast('browser-agent:page-state', state)
        },
        onTabsState: (state) => {
          broadcast('browser-agent:tabs-state', state)
        },
        onSessionStatus: (alive) => {
          broadcast('browser-agent:session-status', alive)
        },
      },
      getMainWindow,
      config
    )
    await localFilesystem.initialize()
    terminal.setSink({
      data: (data) => broadcast('terminal:data', data),
      replay: (data) => broadcast('terminal:replay', data),
      state: (state) => broadcast('terminal:state', state),
      command: (event) => broadcast('terminal:command', event),
    })
    registerIpcHandlers({
      appOrigin,
      allowHttpLocalhost,
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
      browserPanel: {
        setBounds: (sender, bounds) => {
          const win = windowForContents(sender)
          if (!win) return
          if (bounds !== null && !canReportPanelBounds(win, focusedAppWindow())) {
            return
          }
          setBrowserAgentPanelBounds(bounds, win)
        },
        setFocused: (sender, focused) => {
          const win = windowForContents(sender)
          if (win) setBrowserAgentPanelFocused(focused, win)
        },
        setOccluded: (sender, occluded) => {
          const win = windowForContents(sender)
          if (win) setBrowserAgentPanelOccluded(occluded, win)
        },
      },
      beginOAuthConnect: (providerId, scope) => connectFlow.beginConnectHandoff(providerId, scope),
      updates: {
        getState: () => updater?.getState() ?? { status: 'idle' },
        check: () => updater?.check(),
        install: () => updater?.install(),
      },
    })
    await ensureMainWindow()
    installApplicationMenu({
      config,
      getMainWindow,
      allowHttpLocalhost,
      openSettings,
      newWindow: () => void createAndLoadAppWindow(),
      newChat: () => void openMainWindowAt(newChatRoute(config.get('lastRoute'))),
      closeFocusedBrowserTab: (win) => closeFocusedBrowserTab(win),
      reopenClosedBrowserTab: (win) => reopenClosedBrowserTab(win),
      toggleSidebar: () => getMainWindow()?.webContents.send('desktop:command', 'toggle-sidebar'),
      signOut: signOutFromMenu,
      checkForUpdates: () =>
        checkForUpdatesInteractive({ getWindow: getMainWindow, events, handle: updater }),
    })
    setTrayEnabled(config.get('trayEnabled') ?? true)
    updater = initUpdater({
      getWindow: getMainWindow,
      events,
      appOrigin,
      autoDownload: () => config.get('autoDownloadUpdates') ?? true,
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
