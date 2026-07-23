import { join } from 'node:path'
import { createLogger } from '@sim/logger'
import type { BrowserWindow } from 'electron'
import { app, crashReporter, net, session } from 'electron'
import { initDriver as initBrowserAgentDriver } from '@/main/browser-agent/driver'
import {
  closeFocusedTab as closeFocusedBrowserTab,
  setPanelBounds as setBrowserAgentPanelBounds,
} from '@/main/browser-agent/session'
import {
  APP_NAME_FOR_CHANNEL,
  channelForOrigin,
  createConfigStore,
  DEFAULT_ORIGIN,
  partitionForOrigin,
} from '@/main/config'
import { attachContextMenu } from '@/main/context-menu'
import { attachCspFallback } from '@/main/csp'
import { createDesktopSettingsService } from '@/main/desktop-settings'
import { attachDownloadHandling } from '@/main/downloads'
import { createAuthFlow, createConnectFlow, createHandoffManager } from '@/main/handoff'
import { registerIpcHandlers } from '@/main/ipc'
import { createLauncherWindow } from '@/main/launcher-window'
import { attachLoadHealth, type LoadHealthHandle } from '@/main/load-health'
import { LocalFilesystemService } from '@/main/local-filesystem'
import { createEncryptedLocalFilesystemGrantStore } from '@/main/local-filesystem-grant-store'
import { installApplicationMenu } from '@/main/menu'
import { openExternalSafe } from '@/main/navigation'
import { createEventLog } from '@/main/observability'
import { installGlobalGuards } from '@/main/security-guards'
import {
  attachSessionLifecycle,
  decideStartRoute,
  handleConnectIntercept,
  resolveStartRoute,
  tearDownSession,
} from '@/main/session-lifecycle'
import { createLauncherShortcutManager } from '@/main/shortcuts'
import { attachTelemetryPolicy } from '@/main/telemetry-policy'
import { installTray, newChatRoute, settingsRoute, type TrayHandle } from '@/main/tray'
import { checkForUpdatesInteractive, initUpdater, type UpdaterHandle } from '@/main/updater'
import { createMainWindow, setupPermissionHandlers } from '@/main/window'
import { attachWindowOpenPolicy, isPopupContents } from '@/main/windows'

const logger = createLogger('DesktopMain')

const OFFLINE_PAGE = 'static/offline.html'

function main(): void {
  app.enableSandbox()

  const config = createConfigStore(join(app.getPath('userData'), 'settings.json'))
  const events = createEventLog(join(app.getPath('userData'), 'logs'))
  const localFilesystem = new LocalFilesystemService({
    grantStore: createEncryptedLocalFilesystemGrantStore(
      join(app.getPath('userData'), 'local-filesystem-grants.json')
    ),
  })
  const preloadPath = join(__dirname, 'preload.cjs')

  let mainWindow: BrowserWindow | null = null
  let mainWindowCreation: Promise<void> | null = null
  let loadHealth: LoadHealthHandle | null = null
  let tray: TrayHandle | null = null
  let updater: UpdaterHandle | null = null
  const configuredPartitions = new Set<string>()

  const appOrigin = () => config.getOrigin()
  const allowHttpLocalhost = () => !app.isPackaged || appOrigin().startsWith('http://')
  const getMainWindow = () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null)

  /** Restore/show/focus the main window and activate the app (steal focus). */
  function showMainWindow(): void {
    const win = getMainWindow()
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
        await createAndLoadMainWindow()
        win = getMainWindow()
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
      getMainWindow()?.webContents.send('desktop:oauth-connect-complete', result)
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

  async function createAndLoadMainWindow(): Promise<void> {
    if (mainWindowCreation) {
      await mainWindowCreation
      return
    }
    const pending = performCreateAndLoadMainWindow()
    mainWindowCreation = pending
    try {
      await pending
    } finally {
      if (mainWindowCreation === pending) {
        mainWindowCreation = null
      }
    }
  }

  async function performCreateAndLoadMainWindow(): Promise<void> {
    const origin = appOrigin()
    const ses = configureSessionForOrigin(origin)
    const requestedRoute = decideStartRoute(config.get('lastRoute'))
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
      onFullScreenChange: (isFullScreen) => {
        getMainWindow()?.webContents.send('desktop:window-state:changed', { isFullScreen })
      },
      onClosed: () => {
        mainWindow = null
      },
    })
    mainWindow = win
    // A fresh document (reload, origin change, crash recovery) has no browser
    // panel mounted yet — hide the embedded agent-browser view immediately
    // rather than letting it linger over the loading page.
    win.webContents.on('did-start-loading', () => {
      setBrowserAgentPanelBounds(null)
    })
    attachWindowOpenPolicy(win.webContents, {
      appOrigin,
      getMainWindow,
      allowHttpLocalhost: allowHttpLocalhost(),
    })
    attachContextMenu(win.webContents, {
      isDev: !app.isPackaged,
      allowHttpLocalhost: allowHttpLocalhost(),
    })
    loadHealth = attachLoadHealth(win, {
      offlinePagePath: OFFLINE_PAGE,
      getStartUrl: () => `${appOrigin()}${route}`,
      isOnline: () => net.isOnline(),
      events,
    })
    attachSessionLifecycle(win, {
      appSession: ses,
      origin: appOrigin,
      events,
      clearHandoffState: async () => {
        handoff.clear()
        await localFilesystem.forgetAll()
      },
      onReauthRequested: () => void authFlow.beginLoginHandoff(),
    })
    loadHealth.startWatchdog()
    // Fire-and-forget: the window and all its handlers are wired synchronously
    // above, so callers get a usable window immediately and the app menu and
    // updater never wait on the remote page's load (load-health surfaces any
    // failure).
    void win.loadURL(`${origin}${route}`).catch(() => {})
  }

  /** Opens the Sim app's settings page in the main window. */
  function openSettings(): void {
    void openMainWindowAt(settingsRoute(config.get('lastRoute')))
  }

  /**
   * Brings the main window to front (creating it if needed), optionally
   * navigating it to an in-app route first — the seam used by the tray menu
   * and the launcher's open-in-Sim action.
   */
  async function openMainWindowAt(route?: string): Promise<void> {
    if (!getMainWindow()) {
      await createAndLoadMainWindow()
    }
    const win = getMainWindow()
    if (!win) {
      return
    }
    if (route) {
      void win.loadURL(`${appOrigin()}${route}`).catch(() => {})
    }
    // Panel-type windows never activate the app, so opening from the
    // launcher needs the explicit activation showMainWindow performs.
    showMainWindow()
  }

  const desktopSettings = createDesktopSettingsService({
    config,
    getMainWindow,
    openMainWindowAt: (route) => void openMainWindowAt(route),
    setAutoDownloadUpdates: (enabled) => updater?.setAutoDownload(enabled),
  })

  const launcher = createLauncherWindow({
    appOrigin,
    partition: () => partitionForOrigin(appOrigin()),
    preloadPath,
    isPackaged: app.isPackaged,
    themeBackground: () => config.get('themeBackground'),
    openMainWindow: () => void openMainWindowAt(),
    events,
  })

  function toggleLauncher(): void {
    // The launcher shares the app partition; make sure its session policies
    // (permissions, downloads, telemetry) exist before the window loads.
    configureSessionForOrigin(appOrigin())
    launcher.toggle()
  }

  const launcherShortcut = createLauncherShortcutManager(toggleLauncher)

  async function signOutFromMenu(): Promise<void> {
    await localFilesystem.forgetAll()
    const ses = session.fromPartition(partitionForOrigin(appOrigin()))
    await tearDownSession(ses, () => handoff.clear(), events)
    const win = getMainWindow()
    if (win) {
      try {
        await win.loadURL(`${appOrigin()}/login`)
      } catch {}
    }
  }

  app.on('second-instance', () => {
    showMainWindow()
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
  })

  app.on('activate', () => {
    if (app.isReady() && !getMainWindow()) {
      void createAndLoadMainWindow()
    }
  })

  void app.whenReady().then(async () => {
    // Unpackaged runs show Electron's default Dock icon (the packaged icns
    // only applies to built apps), so dev sets the brand icon at runtime.
    if (!app.isPackaged && process.platform === 'darwin') {
      app.dock?.setIcon(join(__dirname, '..', 'static', 'dock-icon.png'))
    }
    events.record('app_launch', {
      version: app.getVersion(),
      electron: process.versions.electron ?? '',
    })
    initBrowserAgentDriver(
      {
        onPageState: (state) => {
          getMainWindow()?.webContents.send('browser-agent:page-state', state)
        },
        onTabsState: (state) => {
          getMainWindow()?.webContents.send('browser-agent:tabs-state', state)
        },
        onSessionStatus: (alive) => {
          getMainWindow()?.webContents.send('browser-agent:session-status', alive)
        },
      },
      getMainWindow
    )
    await localFilesystem.initialize()
    registerIpcHandlers({
      appOrigin,
      allowHttpLocalhost,
      retryLoad: () => loadHealth?.retry(),
      localFilesystem,
      settings: desktopSettings,
      getWindowState: () => ({ isFullScreen: getMainWindow()?.isFullScreen() ?? false }),
      beginOAuthConnect: (providerId, scope) => connectFlow.beginConnectHandoff(providerId, scope),
      updates: {
        getState: () => updater?.getState() ?? { status: 'idle' },
        check: () => updater?.check(),
        install: () => updater?.install(),
      },
      launcher: {
        openChat: (target) => {
          launcher.hide()
          const route = target.chatId
            ? `/workspace/${target.workspaceId}/chat/${target.chatId}`
            : `/workspace/${target.workspaceId}/home`
          void openMainWindowAt(route)
        },
        openApp: () => {
          launcher.hide()
          void openMainWindowAt()
        },
        hide: () => launcher.hide(),
        resize: (height) => launcher.resize(height),
      },
    })
    await createAndLoadMainWindow()
    installApplicationMenu({
      config,
      getMainWindow,
      allowHttpLocalhost,
      openSettings,
      newChat: () => void openMainWindowAt(newChatRoute(config.get('lastRoute'))),
      closeFocusedBrowserTab,
      toggleSidebar: () => getMainWindow()?.webContents.send('desktop:command', 'toggle-sidebar'),
      signOut: () => void signOutFromMenu(),
      checkForUpdates: () =>
        checkForUpdatesInteractive({ getWindow: getMainWindow, events, handle: updater }),
    })
    launcherShortcut.apply(config.get('launcherShortcut'))
    if (config.get('trayEnabled') ?? true) {
      tray = installTray({
        partition: () => partitionForOrigin(appOrigin()),
        appOrigin,
        lastRoute: () => config.get('lastRoute'),
        openMainWindow: (route) => void openMainWindowAt(route),
      })
    }
    updater = initUpdater({
      getWindow: getMainWindow,
      events,
      appOrigin,
      autoDownload: () => config.get('autoDownloadUpdates') ?? true,
      onStateChange: (state) => {
        getMainWindow()?.webContents.send('desktop:updates:state', state)
      },
    })
    desktopSettings.applySystemPreferences()

    // Prewarm Quick Ask a moment after startup so its first summon is instant
    // (window + remote route already loaded). Deferred so it never competes
    // with the main window's initial load.
    setTimeout(() => {
      configureSessionForOrigin(appOrigin())
      launcher.prewarm()
    }, 3000)
  })
}

// Identity and userData must be set before the single-instance lock, which
// writes its lock file into userData. Setting them here (not inside main)
// keeps the SIM_DESKTOP_ORIGIN/USER_DATA test overrides isolated per instance.
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
