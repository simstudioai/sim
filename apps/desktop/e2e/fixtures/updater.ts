import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import type { DesktopUpdateState } from '@sim/desktop-bridge'
import { app, autoUpdater as nativeUpdater, net } from 'electron'
import { MacUpdater } from 'electron-updater'
import { initUpdater } from '@/main/updater'

declare global {
  var desktopUpdaterFixture: {
    check(): void
    install(): void
    finishStaging(): void
    failStaging(): void
    read(): {
      state: DesktopUpdateState
      nativeArchive: string | null
      installed: string[]
      events: { name: string; data: unknown }[]
    }
  }
}

const directory = process.env.SIM_UPDATER_FIXTURE_DIR
const origin = process.env.SIM_UPDATER_FIXTURE_ORIGIN
if (!directory || !origin) throw new Error('Updater fixture configuration is missing')
app.setPath('userData', join(directory, 'user-data'))

void app.whenReady().then(() => {
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
  })

  globalThis.desktopUpdaterFixture = {
    check: () => handle.check(),
    install: () => handle.install(),
    finishStaging: () => {
      if (nativeArchive === null) throw new Error('Native transfer has not finished')
      nativeUpdater.emit('update-downloaded', {}, '', nativeArchive, new Date(), '')
    },
    failStaging: () => nativeUpdater.emit('error', new Error('Native verification failed')),
    read: () => ({ state: handle.getState(), nativeArchive, installed, events }),
  }
})
