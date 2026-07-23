import type { DesktopUpdateState } from '@sim/desktop-bridge'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

const autoUpdaterMock = {
  channel: '',
  allowDowngrade: false,
  autoDownload: true,
  autoInstallOnAppQuit: false,
  logger: null as unknown,
  on: vi.fn(),
  setFeedURL: vi.fn(),
  checkForUpdates: vi.fn(() => Promise.resolve(null)),
  downloadUpdate: vi.fn(() => Promise.resolve([])),
  quitAndInstall: vi.fn(),
}

import { app, dialog, shell } from 'electron'
import {
  checkForUpdatesInteractive,
  feedUrlForOrigin,
  initUpdater,
  isDowngrade,
  isNewerVersion,
  parseSemver,
  resolveUpdateChannel,
} from '@/main/updater'

describe('resolveUpdateChannel', () => {
  it('maps stable versions to latest', () => {
    expect(resolveUpdateChannel('1.2.3')).toBe('latest')
    expect(resolveUpdateChannel('0.5.24')).toBe('latest')
  })

  it('maps prerelease versions to their channel', () => {
    expect(resolveUpdateChannel('1.2.3-beta.1')).toBe('beta')
    expect(resolveUpdateChannel('1.2.3-alpha.2')).toBe('alpha')
  })
})

describe('parseSemver', () => {
  it('parses plain and v-prefixed versions', () => {
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: '' })
    expect(parseSemver('v0.5.24')).toEqual({ major: 0, minor: 5, patch: 24, prerelease: '' })
    expect(parseSemver('1.2.3-beta.1')?.prerelease).toBe('beta.1')
  })

  it('returns null for garbage', () => {
    expect(parseSemver('latest')).toBeNull()
    expect(parseSemver('1.2')).toBeNull()
    expect(parseSemver('')).toBeNull()
  })
})

describe('isDowngrade', () => {
  it('rejects lower versions', () => {
    expect(isDowngrade('1.2.3', '1.2.2')).toBe(true)
    expect(isDowngrade('1.2.3', '1.1.9')).toBe(true)
    expect(isDowngrade('2.0.0', '1.9.9')).toBe(true)
  })

  it('accepts equal and higher versions', () => {
    expect(isDowngrade('1.2.3', '1.2.3')).toBe(false)
    expect(isDowngrade('1.2.3', '1.2.4')).toBe(false)
    expect(isDowngrade('1.2.3', '2.0.0')).toBe(false)
  })

  it('treats a prerelease of the current stable core as a downgrade', () => {
    expect(isDowngrade('1.2.3', '1.2.3-beta.1')).toBe(true)
    expect(isDowngrade('1.2.3-beta.1', '1.2.3')).toBe(false)
  })

  it('compares prerelease identifiers within the same core version', () => {
    expect(isDowngrade('1.4.0-beta.5', '1.4.0-beta.2')).toBe(true)
    expect(isDowngrade('1.4.0-beta.2', '1.4.0-beta.10')).toBe(false)
    expect(isDowngrade('1.4.0-beta.2', '1.4.0-beta.2')).toBe(false)
    expect(isDowngrade('1.4.0-rc.1', '1.4.0-beta.9')).toBe(true)
  })

  it('treats unparseable versions as downgrades', () => {
    expect(isDowngrade('1.2.3', 'nightly')).toBe(true)
    expect(isDowngrade('garbage', '1.2.3')).toBe(true)
  })
})

describe('isNewerVersion', () => {
  it('is true only for strictly newer candidates', () => {
    expect(isNewerVersion('1.2.4', '1.2.3')).toBe(true)
    expect(isNewerVersion('1.2.4-alpha.3', '1.2.3')).toBe(true)
    expect(isNewerVersion('1.2.3', '1.2.3')).toBe(false)
    expect(isNewerVersion('1.2.2', '1.2.3')).toBe(false)
  })

  it('never offers an unparseable feed version', () => {
    expect(isNewerVersion('latest', '1.2.3')).toBe(false)
    expect(isNewerVersion('', '1.2.3')).toBe(false)
  })
})

describe('feedUrlForOrigin', () => {
  it('builds the per-env feed URL from the configured origin', () => {
    expect(feedUrlForOrigin('https://www.dev.sim.ai')).toBe(
      'https://www.dev.sim.ai/api/desktop/update'
    )
    expect(feedUrlForOrigin('http://localhost:3000')).toBe(
      'http://localhost:3000/api/desktop/update'
    )
  })

  it('rejects non-http origins and garbage', () => {
    expect(feedUrlForOrigin('file:///tmp/app')).toBeNull()
    expect(feedUrlForOrigin('not a url')).toBeNull()
  })
})

describe('initUpdater state machine', () => {
  const events = { record: vi.fn(), filePath: '/tmp/desktop-events.log' }

  function emit(event: string, ...args: unknown[]) {
    for (const [name, listener] of autoUpdaterMock.on.mock.calls) {
      if (name === event) {
        ;(listener as (...values: unknown[]) => void)(...args)
      }
    }
  }

  async function createUpdater(options?: { autoDownload?: boolean; feedAvailable?: boolean }) {
    const states: DesktopUpdateState[] = []
    const handle = initUpdater({
      getWindow: () => null,
      events,
      appOrigin: () => 'https://www.dev.sim.ai',
      autoDownload: () => options?.autoDownload ?? true,
      onStateChange: (state) => states.push(state),
      loadAutoUpdater: () =>
        autoUpdaterMock as unknown as typeof import('electron-updater')['autoUpdater'],
      probeOriginFeed: async () => options?.feedAvailable ?? false,
      canSelfUpdate: async () => true,
    })
    // Engine selection (signature detection) resolves asynchronously.
    await vi.advanceTimersByTimeAsync(0)
    return { handle, states }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    autoUpdaterMock.on.mockClear()
    autoUpdaterMock.setFeedURL.mockClear()
    autoUpdaterMock.checkForUpdates.mockClear()
    autoUpdaterMock.downloadUpdate.mockClear()
    autoUpdaterMock.quitAndInstall.mockClear()
    // Keep the update-downloaded dialog from resolving into quitAndInstall.
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 1, checkboxChecked: false })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('walks check -> download -> ready and installs only from ready', async () => {
    const { handle, states } = await createUpdater()
    expect(handle.getState()).toEqual({ status: 'idle' })

    handle.install()
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()

    emit('checking-for-update')
    emit('update-available', { version: '2.0.0' })
    emit('download-progress', { percent: 41.7 })
    emit('update-downloaded', { version: '2.0.0' })

    expect(states).toEqual([
      { status: 'checking' },
      { status: 'downloading', version: '2.0.0' },
      { status: 'downloading', version: '2.0.0', percent: 42 },
      { status: 'ready', version: '2.0.0' },
    ])

    handle.install()
    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('stops at available and downloads on demand when auto-download is off', async () => {
    autoUpdaterMock.autoDownload = false
    const { handle } = await createUpdater({ autoDownload: false })

    emit('update-available', { version: '2.0.0' })
    expect(handle.getState()).toEqual({ status: 'available', version: '2.0.0' })

    handle.check()
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
  })

  it('checks from idle and ignores re-entrant checks while busy', async () => {
    const { handle } = await createUpdater()
    handle.check()
    await vi.advanceTimersByTimeAsync(0)
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)

    emit('checking-for-update')
    handle.check()
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('resets to idle when a downloaded update is a blocked downgrade', async () => {
    const { handle } = await createUpdater()
    emit('update-downloaded', { version: '0.0.1' })
    expect(handle.getState()).toEqual({ status: 'idle' })
    handle.install()
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
  })

  it('surfaces updater errors and recovers via update-not-available', async () => {
    const { handle } = await createUpdater()
    emit('error', new Error('feed unreachable'))
    expect(handle.getState()).toEqual({ status: 'error' })
    emit('update-not-available')
    expect(handle.getState()).toEqual({ status: 'idle' })
  })

  it('switches to the per-env origin feed when the origin serves one', async () => {
    await createUpdater({ feedAvailable: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(autoUpdaterMock.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'https://www.dev.sim.ai/api/desktop/update',
      channel: 'latest',
    })
    expect(autoUpdaterMock.channel).toBe('latest')
  })

  it('keeps the packaged GitHub feed when the origin has no feed', async () => {
    await createUpdater({ feedAvailable: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled()
  })
})

function manifest(version: string): string {
  return [
    `version: ${version}`,
    'files:',
    `  - url: https://github.com/simstudioai/sim/releases/download/v${version}/Sim-${version}-universal-mac.zip`,
    '    sha512: abc',
    `  - url: https://github.com/simstudioai/sim/releases/download/v${version}/Sim-${version}-universal.dmg`,
    '    sha512: def',
    `path: https://github.com/simstudioai/sim/releases/download/v${version}/Sim-${version}-universal-mac.zip`,
    "releaseDate: '2026-07-23T00:00:00.000Z'",
  ].join('\n')
}

describe('initUpdater manual mode (no Developer ID signature)', () => {
  const events = { record: vi.fn(), filePath: '/tmp/desktop-events.log' }

  async function createManualUpdater(fetchManifest: (url: string) => Promise<string | null>) {
    const states: DesktopUpdateState[] = []
    const handle = initUpdater({
      getWindow: () => null,
      events,
      appOrigin: () => 'https://www.dev.sim.ai',
      onStateChange: (state) => states.push(state),
      canSelfUpdate: async () => false,
      fetchManifest,
    })
    await vi.advanceTimersByTimeAsync(0)
    return { handle, states }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    events.record.mockClear()
    vi.mocked(shell.openExternal).mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('offers a newer feed version as a manual download of the dmg', async () => {
    const fetchManifest = vi.fn(async () => manifest('9.9.9'))
    const { handle } = await createManualUpdater(fetchManifest)

    handle.check()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchManifest).toHaveBeenCalledWith(
      'https://www.dev.sim.ai/api/desktop/update/latest-mac.yml'
    )
    expect(handle.getState()).toEqual({ status: 'available', version: '9.9.9', manual: true })

    // The `available` advance opens the browser instead of downloading.
    handle.check()
    expect(shell.openExternal).toHaveBeenCalledWith(
      'https://github.com/simstudioai/sim/releases/download/v9.9.9/Sim-9.9.9-universal.dmg'
    )

    // install() from manual `available` opens the same download.
    handle.install()
    expect(shell.openExternal).toHaveBeenCalledTimes(2)
  })

  it('stays idle when the feed version is not newer', async () => {
    const { handle } = await createManualUpdater(async () => manifest(app.getVersion()))
    handle.check()
    await vi.advanceTimersByTimeAsync(0)
    expect(handle.getState()).toEqual({ status: 'idle', manual: true })
    expect(shell.openExternal).not.toHaveBeenCalled()
  })

  it('stays idle when the origin serves no feed', async () => {
    const { handle } = await createManualUpdater(async () => null)
    handle.check()
    await vi.advanceTimersByTimeAsync(0)
    expect(handle.getState()).toEqual({ status: 'idle', manual: true })
  })

  it('surfaces manifest fetch failures as errors', async () => {
    const { handle } = await createManualUpdater(async () => {
      throw new Error('network down')
    })
    handle.check()
    await vi.advanceTimersByTimeAsync(0)
    expect(handle.getState()).toEqual({ status: 'error', manual: true })
  })

  it('checks on the scheduled interval', async () => {
    const fetchManifest = vi.fn(async () => manifest('9.9.9'))
    await createManualUpdater(fetchManifest)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchManifest).toHaveBeenCalledTimes(1)
  })
})

describe('checkForUpdatesInteractive', () => {
  const events = { record: vi.fn(), filePath: '/tmp/desktop-events.log' }

  async function manualHandle(version: string) {
    const handle = initUpdater({
      getWindow: () => null,
      events,
      appOrigin: () => 'https://www.dev.sim.ai',
      canSelfUpdate: async () => false,
      fetchManifest: async () => manifest(version),
    })
    await vi.advanceTimersByTimeAsync(0)
    return handle
  }

  beforeEach(() => {
    vi.useFakeTimers()
    ;(app as unknown as { isPackaged: boolean }).isPackaged = true
    events.record.mockClear()
    vi.mocked(dialog.showMessageBox).mockClear()
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 1, checkboxChecked: false })
    vi.mocked(shell.openExternal).mockClear()
  })

  afterEach(() => {
    ;(app as unknown as { isPackaged: boolean }).isPackaged = false
    vi.useRealTimers()
  })

  it('offers the manual download and opens it on Download', async () => {
    const handle = await manualHandle('9.9.9')
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0, checkboxChecked: false })

    checkForUpdatesInteractive({ getWindow: () => null, events, handle })
    await vi.advanceTimersByTimeAsync(0)

    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Sim 9.9.9 is available' })
    )
    expect(shell.openExternal).toHaveBeenCalledWith(
      'https://github.com/simstudioai/sim/releases/download/v9.9.9/Sim-9.9.9-universal.dmg'
    )
  })

  it('reports up to date when the feed has nothing newer', async () => {
    const handle = await manualHandle(app.getVersion())

    checkForUpdatesInteractive({ getWindow: () => null, events, handle })
    await vi.advanceTimersByTimeAsync(0)

    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Sim is up to date' })
    )
    expect(shell.openExternal).not.toHaveBeenCalled()
  })

  it('only explains packaged-build updates when unpackaged', async () => {
    ;(app as unknown as { isPackaged: boolean }).isPackaged = false
    checkForUpdatesInteractive({ getWindow: () => null, events, handle: null })
    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Updates are only available in packaged builds' })
    )
  })
})
