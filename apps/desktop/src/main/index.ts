import { join } from 'node:path'
import { createLogger } from '@sim/logger'
import type { BrowserWindow } from 'electron'
import { app, net, session } from 'electron'
import {
  initDriver as initBrowserAgentDriver,
  setPanelBounds as setBrowserAgentPanelBounds,
} from '@/main/browser-agent/driver'
import { createConfigStore, partitionForOrigin } from '@/main/config'
import { attachContextMenu } from '@/main/context-menu'
import { attachDownloadHandling } from '@/main/downloads'
import { createAuthFlow, createHandoffManager } from '@/main/handoff'
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
  tearDownSession,
} from '@/main/session-lifecycle'
import { closeSettingsWindow, openSettingsWindow } from '@/main/settings-window'
import { createLauncherShortcutManager, LAUNCHER_SHORTCUT_PRESETS } from '@/main/shortcuts'
import { attachTelemetryPolicy } from '@/main/telemetry-policy'
import { installTray } from '@/main/tray'
import { checkForUpdatesInteractive, initUpdater } from '@/main/updater'
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
  let loadHealth: LoadHealthHandle | null = null
  const configuredPartitions = new Set<string>()

  const appOrigin = () => config.getOrigin()
  const allowHttpLocalhost = () => !app.isPackaged || appOrigin().startsWith('http://')
  const getMainWindow = () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null)

  const handoff = createHandoffManager(
    {
      origin: appOrigin,
      openExternal: (url) => openExternalSafe(url, allowHttpLocalhost()),
      events,
    },
    (callback) => void authFlow.handleCallback(callback)
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
    attachDownloadHandling(ses, events)
    attachTelemetryPolicy(ses, config.get('blockThirdPartyAnalytics') ?? true)
    ses.setSpellCheckerLanguages(['en-US'])
    return ses
  }

  async function createAndLoadMainWindow(): Promise<void> {
    const origin = appOrigin()
    const ses = configureSessionForOrigin(origin)
    const win = createMainWindow({
      config,
      events,
      appOrigin,
      partition: partitionForOrigin(origin),
      preloadPath,
      isPackaged: app.isPackaged,
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
      getStartUrl: () => `${appOrigin()}${decideStartRoute('unknown', config.get('lastRoute'))}`,
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
    const route = decideStartRoute('unknown', config.get('lastRoute'))
    // Fire-and-forget: the window and all its handlers are wired synchronously
    // above, so callers get a usable window immediately and the app menu and
    // updater never wait on the remote page's load (load-health surfaces any
    // failure).
    void win.loadURL(`${origin}${route}`).catch(() => {})
  }

  function openSettings(): void {
    openSettingsWindow({ preloadPath, isPackaged: app.isPackaged, getMainWindow })
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
    if (win.isMinimized()) {
      win.restore()
    }
    win.show()
    win.focus()
    // Panel-type windows never activate the app, so opening from the
    // launcher needs an explicit activation to take over from the app the
    // user was in.
    app.focus({ steal: true })
  }

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

  async function applyOrigin(raw: string) {
    const previousOrigin = appOrigin()
    const result = config.setOrigin(raw)
    if (!result.ok) {
      return result
    }
    closeSettingsWindow()
    if (result.origin === previousOrigin) {
      return result
    }
    logger.info('Server origin changed; recreating window')
    events.record('origin_changed')
    await localFilesystem.forgetAll()
    handoff.clear()
    // The launcher window is bound to the old origin's partition; the next
    // summon recreates it against the new origin.
    launcher.destroy()
    const win = getMainWindow()
    if (win) {
      mainWindow = null
      win.destroy()
    }
    await createAndLoadMainWindow()
    return result
  }

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
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) {
        win.restore()
      }
      win.focus()
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', () => {
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
        onSessionStatus: (alive) => {
          getMainWindow()?.webContents.send('browser-agent:session-status', alive)
        },
      },
      getMainWindow
    )
    await localFilesystem.initialize()
    registerIpcHandlers({
      config,
      appOrigin,
      allowHttpLocalhost,
      retryLoad: () => loadHealth?.retry(),
      openSettings,
      closeSettings: closeSettingsWindow,
      applyOrigin,
      localFilesystem,
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
      launcherShortcut: {
        get: () => ({
          shortcut: launcherShortcut.current(),
          presets: [...LAUNCHER_SHORTCUT_PRESETS],
          status: launcherShortcut.status(),
        }),
        set: (raw) => {
          const status = launcherShortcut.apply(raw)
          config.set('launcherShortcut', launcherShortcut.current())
          return {
            shortcut: launcherShortcut.current(),
            presets: [...LAUNCHER_SHORTCUT_PRESETS],
            status,
          }
        },
      },
    })
    await createAndLoadMainWindow()
    installApplicationMenu({
      isPackaged: app.isPackaged,
      config,
      getMainWindow,
      allowHttpLocalhost,
      openSettings,
      signIn: () => void authFlow.beginLoginHandoff(),
      signOut: () => void signOutFromMenu(),
      checkForUpdates: () => checkForUpdatesInteractive({ getWindow: getMainWindow, events }),
      eventLogPath: events.filePath,
    })
    launcherShortcut.apply(config.get('launcherShortcut'))
    if (config.get('trayEnabled') ?? true) {
      installTray({
        partition: () => partitionForOrigin(appOrigin()),
        appOrigin,
        lastRoute: () => config.get('lastRoute'),
        openMainWindow: (route) => void openMainWindowAt(route),
        openSettings,
      })
    }
    initUpdater({ getWindow: getMainWindow, events })

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
app.setName('Sim')
if (process.env.SIM_DESKTOP_USER_DATA) {
  app.setPath('userData', process.env.SIM_DESKTOP_USER_DATA)
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  main()
}
