import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import type { DesktopUpdateState } from '@sim/desktop-bridge'
import { app, BrowserWindow, autoUpdater as nativeUpdater, net } from 'electron'
import { MacUpdater } from 'electron-updater'
import { countWindowsWithUnsavedChanges, describeInFlightWork } from '@/main/in-flight-work'
import { initUpdater } from '@/main/updater'

/** What a window's page does on `beforeunload`, shaped like the web app's own listeners. */
type FixtureUnloadListener = 'none' | 'passive' | 'unsaved-edits'

type FixtureDialog = Pick<
  Electron.MessageBoxOptions,
  'title' | 'message' | 'buttons' | 'defaultId' | 'cancelId'
>

declare global {
  var desktopUpdaterFixture: {
    check(): void
    install(): void
    finishStaging(): void
    failStaging(): void
    setWork(work: {
      terminalCommands: string[]
      browserToolRunning: boolean
      unloadListener: FixtureUnloadListener
      /** Adds a second window whose renderer is blocked past the shell's probe deadline. */
      hungWindow?: boolean
    }): Promise<void>
    read(): {
      state: DesktopUpdateState
      nativeArchive: string | null
      installed: string[]
      events: { name: string; data: unknown }[]
      dialogs: FixtureDialog[]
    }
  }
  /** Filled by the spec's `showShellDialog` stub, which answers with `updaterFixtureDialogResponse`. */
  var updaterFixtureDialogs: FixtureDialog[]
  var updaterFixtureDialogResponse: number
}

const directory = process.env.SIM_UPDATER_FIXTURE_DIR
const origin = process.env.SIM_UPDATER_FIXTURE_ORIGIN
if (!directory || !origin) throw new Error('Updater fixture configuration is missing')
app.setPath('userData', join(directory, 'user-data'))

globalThis.updaterFixtureDialogs = []
globalThis.updaterFixtureDialogResponse = 0

void app.whenReady().then(async () => {
  const configPath = join(directory, 'updater.yml')
  const cache = relative(join(homedir(), 'Library', 'Caches'), join(directory, 'cache'))
  writeFileSync(configPath, `updaterCacheDirName: ${JSON.stringify(cache)}\n`)

  let feed: Electron.FeedURLOptions | undefined
  let nativeArchive: string | null = null
  const installed: string[] = []
  const events: { name: string; data: unknown }[] = []

  /** Native verification and installation are simulated; MacUpdater and both HTTP transfers run. */
  nativeUpdater.setFeedURL = (options) => {
    feed = options
    nativeArchive = null
  }
  nativeUpdater.checkForUpdates = () => {
    void (async () => {
      if (!feed) throw new Error('Native feed was not configured')
      const response = await net.fetch(feed.url, { headers: feed.headers })
      const manifest: { url: string } = await response.json()
      const archive = await net.fetch(manifest.url)
      nativeArchive = await archive.text()
    })().catch((error) => nativeUpdater.emit('error', error))
  }
  nativeUpdater.quitAndInstall = () => {
    if (nativeArchive === null) throw new Error('Cannot install before native staging')
    installed.push(nativeArchive)
  }

  // A real renderer, so the unsaved-edits probe runs against Chromium's own event dispatch.
  const page = new BrowserWindow({ show: false })
  page.webContents.on('will-prevent-unload', (event) => event.preventDefault())
  await page.loadURL('about:blank')
  let terminalCommands: string[] = []
  let browserToolRunning = false
  let hungPage: BrowserWindow | null = null

  const updater = new MacUpdater()
  updater.forceDevUpdateConfig = true
  updater.disableDifferentialDownload = true
  updater.updateConfigPath = configPath
  updater.setFeedURL({ provider: 'generic', url: origin })
  const handle = initUpdater({
    getWindow: () => null,
    events: { filePath: '', record: (name, data) => events.push({ name, data }) },
    appOrigin: () => origin,
    loadAutoUpdater: () => updater,
    canSelfUpdate: async () => true,
    probeOriginFeed: async () => false,
    installStatePath: join(directory, 'update-install.json'),
    describeInFlightWork: async () =>
      describeInFlightWork({
        terminalCommands,
        computerUseApp: null,
        browserToolRunning,
        agentWorkRunning: false,
        downloadCount: 0,
        ...(await countWindowsWithUnsavedChanges(
          hungPage ? [page.webContents, hungPage.webContents] : [page.webContents]
        )),
      }),
  })

  globalThis.desktopUpdaterFixture = {
    check: () => handle.check(),
    install: () => handle.install(),
    finishStaging: () => {
      if (nativeArchive === null) throw new Error('Native transfer has not finished')
      nativeUpdater.emit('update-downloaded', {}, '', nativeArchive, new Date(), '')
    },
    failStaging: () => nativeUpdater.emit('error', new Error('Native verification failed')),
    setWork: async (work) => {
      terminalCommands = work.terminalCommands
      browserToolRunning = work.browserToolRunning
      if (hungPage) {
        // Let the blocked renderer finish first; destroying it mid-loop stalls the app's exit.
        await hungPage.webContents.executeJavaScript('0')
        hungPage.destroy()
        hungPage = null
      }
      if (work.hungWindow) {
        hungPage = new BrowserWindow({ show: false })
        await hungPage.loadURL('about:blank')
        await hungPage.webContents.executeJavaScript(`window.addEventListener('beforeunload', () => {
          const until = Date.now() + 1500
          while (Date.now() < until) {}
        })`)
      }
      await page.webContents.executeJavaScript(`(() => {
        for (const listener of window.fixtureUnloadListeners ?? []) {
          window.removeEventListener('beforeunload', listener)
        }
        window.fixtureUnloadListeners = []
        const kind = ${JSON.stringify(work.unloadListener)}
        if (kind === 'none') return
        // 'passive' runs on unload without holding the page, like the chat's handoff cleanup.
        const listener =
          kind === 'unsaved-edits' ? (event) => event.preventDefault() : () => {}
        window.addEventListener('beforeunload', listener)
        window.fixtureUnloadListeners.push(listener)
      })()`)
    },
    read: () => ({
      state: handle.getState(),
      nativeArchive,
      installed,
      events,
      dialogs: globalThis.updaterFixtureDialogs,
    }),
  }
})
