import type { DesktopUpdateState } from '@sim/desktop-bridge'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

let updaterChannel = ''
const autoUpdaterMock = {
  get channel() {
    return updaterChannel
  },
  set channel(value: string) {
    updaterChannel = value
    this.allowDowngrade = true
  },
  allowDowngrade: false,
  autoDownload: true,
  autoInstallOnAppQuit: false,
  autoRunAppAfterInstall: true,
  logger: null as unknown,
  on: vi.fn(),
  setFeedURL: vi.fn(),
  checkForUpdates: vi.fn<() => Promise<null>>(),
  downloadUpdate: vi.fn(() => Promise.resolve([])),
  quitAndInstall: vi.fn(),
}

import { app, dialog, shell, autoUpdater as squirrelUpdater } from 'electron'
import {
  checkForUpdatesInteractive,
  feedUrlForOrigin,
  initUpdater,
  isDowngrade,
  isNewerVersion,
  readUpdateManifest,
  resolveUpdateChannel,
  type UpdaterHandle,
} from '@/main/updater'

describe('resolveUpdateChannel', () => {
  it('maps stable versions to latest', () => {
    expect(resolveUpdateChannel('1.2.3')).toBe('latest')
    expect(resolveUpdateChannel('0.5.24')).toBe('latest')
  })

  it('maps prerelease versions to their channel', () => {
    expect(resolveUpdateChannel('1.2.3-dev.2')).toBe('dev')
    expect(resolveUpdateChannel('1.2.3-staging.1')).toBe('staging')
  })
})

describe('isDowngrade', () => {
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
})

describe('isNewerVersion', () => {
  it('never offers an unparseable feed version', () => {
    expect(isNewerVersion('latest', '1.2.3')).toBe(false)
    expect(isNewerVersion('', '1.2.3')).toBe(false)
  })
})

describe('feedUrlForOrigin', () => {
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

  /** Replays a native Squirrel.Mac event, e.g. `update-downloaded` once a bundle is staged. */
  function emitSquirrel(event: string) {
    for (const [name, listener] of vi.mocked(squirrelUpdater.on).mock.calls) {
      if (name === event) {
        ;(listener as () => void)()
      }
    }
  }

  /** Drives a fresh updater to a Squirrel-staged `ready` update for `version`. */
  async function stageUpdate(handle: UpdaterHandle, version: string) {
    handle.check()
    await vi.advanceTimersByTimeAsync(0)
    emit('update-available', { version })
    emit('update-downloaded', { version })
    emitSquirrel('update-downloaded')
  }

  async function createUpdater(options?: {
    autoDownload?: boolean
    feedAvailable?: boolean | 'no-release'
    probeOriginFeed?: (feedUrl: string) => Promise<boolean | 'no-release'>
    beforeInstall?: () => Promise<void>
    setRelaunchPending?: (pending: boolean) => void
  }) {
    const states: DesktopUpdateState[] = []
    const handle = initUpdater({
      getWindow: () => null,
      events,
      appOrigin: () => 'https://www.dev.sim.ai',
      autoDownload: () => options?.autoDownload ?? true,
      onStateChange: (state) => states.push(state),
      loadAutoUpdater: () =>
        autoUpdaterMock as unknown as typeof import('electron-updater')['autoUpdater'],
      probeOriginFeed: options?.probeOriginFeed ?? (async () => options?.feedAvailable ?? false),
      canSelfUpdate: async () => true,
      platform: 'darwin',
      beforeInstall: options?.beforeInstall,
      setRelaunchPending: options?.setRelaunchPending,
    })
    // Engine selection (signature detection) resolves asynchronously.
    await vi.advanceTimersByTimeAsync(0)
    return { handle, states }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    autoUpdaterMock.on.mockClear()
    vi.mocked(squirrelUpdater.on).mockClear()
    autoUpdaterMock.setFeedURL.mockClear()
    autoUpdaterMock.checkForUpdates.mockClear()
    autoUpdaterMock.checkForUpdates.mockImplementation(() => new Promise(() => {}))
    autoUpdaterMock.downloadUpdate.mockClear()
    autoUpdaterMock.quitAndInstall.mockClear()
    autoUpdaterMock.autoRunAppAfterInstall = false
    updaterChannel = ''
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0, checkboxChecked: false })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('walks check -> validated download -> ready and installs only after confirmation', async () => {
    const { handle, states } = await createUpdater()
    expect(handle.getState()).toEqual({ status: 'idle' })

    handle.install()
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()

    handle.check()
    await vi.advanceTimersByTimeAsync(0)
    emit('update-available', { version: '2.0.0' })
    emit('download-progress', { percent: 41.7 })
    emit('update-downloaded', { version: '2.0.0' })

    expect(states).toEqual([
      { status: 'checking' },
      { status: 'downloading', version: '2.0.0' },
      { status: 'downloading', version: '2.0.0', percent: 42 },
      { status: 'ready', version: '2.0.0' },
    ])
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
    expect(autoUpdaterMock.autoDownload).toBe(false)
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(1)

    handle.install()
    await vi.advanceTimersByTimeAsync(0)
    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: ['Later', 'Restart and update'],
        defaultId: 0,
        cancelId: 0,
      })
    )
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()

    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({
      response: 1,
      checkboxChecked: false,
    })
    handle.install()
    await vi.advanceTimersByTimeAsync(0)
    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('keeps one restart confirmation in flight across repeated install requests', async () => {
    let resolveConfirmation: (result: { response: number; checkboxChecked: boolean }) => void =
      () => {
        throw new Error('Restart confirmation did not initialize')
      }
    vi.mocked(dialog.showMessageBox).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConfirmation = resolve
        })
    )
    const { handle } = await createUpdater()

    handle.check()
    await vi.advanceTimersByTimeAsync(0)
    emit('update-available', { version: '2.0.0' })
    emit('update-downloaded', { version: '2.0.0' })
    vi.mocked(dialog.showMessageBox).mockClear()
    handle.install()
    handle.install()

    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1)
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()

    resolveConfirmation({ response: 1, checkboxChecked: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('applies the download preference without enabling unvalidated library downloads', async () => {
    const { handle } = await createUpdater()
    handle.setAutoDownload(false)

    handle.check()
    await vi.advanceTimersByTimeAsync(0)
    emit('update-available', { version: '2.0.0' })

    expect(autoUpdaterMock.autoDownload).toBe(false)
    expect(handle.getState()).toEqual({ status: 'available', version: '2.0.0' })
    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled()
  })

  it('awaits desktop teardown before Squirrel terminates the process', async () => {
    let finishTeardown: (() => void) | undefined
    const beforeInstall = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishTeardown = resolve
        })
    )
    const { handle } = await createUpdater({ autoDownload: false, beforeInstall })

    handle.check()
    await vi.advanceTimersByTimeAsync(0)
    emit('update-available', { version: '2.0.0' })
    handle.check()
    emit('update-downloaded', { version: '2.0.0' })
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({
      response: 1,
      checkboxChecked: false,
    })
    handle.install()
    await vi.advanceTimersByTimeAsync(0)

    expect(beforeInstall).toHaveBeenCalledTimes(1)
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()

    finishTeardown?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('does not install when the updater fails during pre-install teardown', async () => {
    let finishTeardown: (() => void) | undefined
    const setRelaunchPending = vi.fn()
    const { handle } = await createUpdater({
      beforeInstall: () =>
        new Promise<void>((resolve) => {
          finishTeardown = resolve
        }),
      setRelaunchPending,
    })

    handle.check()
    await vi.advanceTimersByTimeAsync(0)
    emit('update-available', { version: '2.0.0' })
    emit('update-downloaded', { version: '2.0.0' })
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({
      response: 1,
      checkboxChecked: false,
    })
    handle.install()
    await vi.advanceTimersByTimeAsync(0)

    emit('error', new Error('native staging failed'))
    finishTeardown?.()
    await vi.advanceTimersByTimeAsync(0)

    expect(handle.getState()).toEqual({ status: 'error', version: '2.0.0' })
    expect(setRelaunchPending).not.toHaveBeenCalledWith(true)
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
  })

  it('bypasses renderer unload guards only after teardown succeeds', async () => {
    const setRelaunchPending = vi.fn()
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({
      response: 1,
      checkboxChecked: false,
    })
    const { handle } = await createUpdater({
      beforeInstall: async () => {},
      setRelaunchPending,
    })

    handle.check()
    await vi.advanceTimersByTimeAsync(0)
    emit('update-available', { version: '2.0.0' })
    emit('update-downloaded', { version: '2.0.0' })
    handle.install()

    expect(setRelaunchPending).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(0)
    expect(setRelaunchPending).toHaveBeenCalledWith(true)
    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('replaces a staged update with a newer release instead of installing the stale build', async () => {
    const { handle, states } = await createUpdater()
    await stageUpdate(handle, '2.0.0')
    expect(handle.getState()).toEqual({ status: 'ready', version: '2.0.0' })
    states.length = 0

    await vi.advanceTimersByTimeAsync(10_000)
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(2)
    emit('checking-for-update')
    emit('update-available', { version: '2.1.0' })
    emit('download-progress', { percent: 50 })
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(2)

    emit('update-downloaded', { version: '2.1.0' })
    expect(handle.getState()).toEqual({ status: 'ready', version: '2.0.0' })
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(true)

    emitSquirrel('update-downloaded')
    expect(states).toEqual([{ status: 'ready', version: '2.1.0' }])
    expect(events.record).toHaveBeenCalledWith('update_downloaded', { version: '2.1.0' })
  })

  it('does not re-check a ready update until Squirrel has staged it', async () => {
    const { handle } = await createUpdater()
    handle.check()
    await vi.advanceTimersByTimeAsync(0)
    emit('update-available', { version: '2.0.0' })
    emit('update-downloaded', { version: '2.0.0' })

    await vi.advanceTimersByTimeAsync(10_000)
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)

    emitSquirrel('update-downloaded')
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 - 10_000)
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('keeps a staged update when a background re-check finds nothing newer or fails', async () => {
    const { handle, states } = await createUpdater()
    await stageUpdate(handle, '2.0.0')
    states.length = 0

    await vi.advanceTimersByTimeAsync(10_000)
    emit('update-available', { version: '2.0.0' })
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 - 10_000)
    emit('update-not-available')
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
    emit('error', new Error('net::ERR_NETWORK_CHANGED'))
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
    emit('update-available', { version: '2.1.0' })
    emit('error', new Error('download interrupted'))
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
    emit('update-available', { version: '2.2.0' })
    emit('update-downloaded', { version: '2.2.0' })
    emit('error', new Error('Squirrel could not verify the replacement'))

    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(6)
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(3)
    expect(states).toEqual([])
    expect(handle.getState()).toEqual({ status: 'ready', version: '2.0.0' })
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(true)

    emitSquirrel('update-downloaded')
    expect(handle.getState()).toEqual({ status: 'ready', version: '2.0.0' })
  })

  it('installs a replacement that finished staging while the restart prompt was open', async () => {
    let resolveConfirmation: (result: { response: number; checkboxChecked: boolean }) => void =
      () => {
        throw new Error('Restart confirmation did not initialize')
      }
    const { handle } = await createUpdater()
    await stageUpdate(handle, '2.0.0')
    await vi.advanceTimersByTimeAsync(10_000)
    emit('update-available', { version: '2.1.0' })

    vi.mocked(dialog.showMessageBox).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConfirmation = resolve
        })
    )
    handle.install()
    emit('update-downloaded', { version: '2.1.0' })
    emitSquirrel('update-downloaded')
    expect(handle.getState()).toEqual({ status: 'ready', version: '2.1.0' })
    resolveConfirmation({ response: 1, checkboxChecked: false })
    await vi.advanceTimersByTimeAsync(0)

    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('withdraws an offered update once a re-check stores a blocked candidate', async () => {
    const { handle } = await createUpdater({ autoDownload: false })
    handle.check()
    await vi.advanceTimersByTimeAsync(0)
    emit('update-available', { version: '2.0.0' })

    await vi.advanceTimersByTimeAsync(10_000)
    emit('update-available', { version: '2.1.0-dev.1' })

    expect(handle.getState()).toEqual({ status: 'idle' })
    handle.check()
    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled()
  })

  it('resets to idle when a downloaded update is a blocked downgrade', async () => {
    const { handle } = await createUpdater()
    handle.check()
    await vi.advanceTimersByTimeAsync(0)
    emit('update-available', { version: '2.0.0' })
    emit('update-downloaded', { version: '0.0.1' })
    expect(handle.getState()).toEqual({ status: 'idle' })
    handle.install()
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
  })

  it('never exposes an equal, older, malformed, or cross-stream candidate as an update', async () => {
    const { handle } = await createUpdater()

    for (const version of ['1.0.0', '0.9.9', 'nightly', '2.0.0-dev.1']) {
      handle.check()
      await vi.advanceTimersByTimeAsync(0)
      emit('update-available', { version })
      expect(handle.getState()).toEqual({ status: 'idle' })
    }

    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled()
  })

  it('accepts only exact repository, tag, and artifact URLs from an origin feed', async () => {
    const { handle } = await createUpdater({ feedAvailable: true })
    handle.check()
    await vi.advanceTimersByTimeAsync(0)

    emit('update-available', {
      version: '2.0.0',
      files: [
        {
          url: 'https://github.com/simstudioai/sim/releases/download/v2.0.0/Sim-2.0.0-universal.zip',
          sha512: 'checksum',
        },
      ],
    })

    expect(handle.getState()).toEqual({ status: 'downloading', version: '2.0.0' })
  })

  it('blocks an origin manifest that points at an unexpected release artifact', async () => {
    const { handle } = await createUpdater({ feedAvailable: true })
    handle.check()
    await vi.advanceTimersByTimeAsync(0)

    emit('update-available', {
      version: '2.0.0',
      files: [
        {
          url: 'https://github.com/simstudioai/sim/releases/download/v1.9.9/unreviewed.dmg',
          sha512: 'checksum',
        },
      ],
    })

    expect(handle.getState()).toEqual({ status: 'idle' })
    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled()
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(false)
    expect(events.record).toHaveBeenCalledWith('update_blocked_version', {
      version: '2.0.0',
      reason: 'unusable-url',
    })
  })

  it('ignores a feed probe that resolves after its timeout generation', async () => {
    let resolveProbe: ((available: boolean) => void) | undefined
    const probeOriginFeed = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveProbe = resolve
        })
    )
    const { handle } = await createUpdater({ probeOriginFeed })

    handle.check()
    await vi.advanceTimersByTimeAsync(10_000)
    resolveProbe?.(true)
    await vi.advanceTimersByTimeAsync(0)

    expect(handle.getState()).toEqual({ status: 'error' })
    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled()
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
  })

  it('waits for a timed-out updater request to settle before retrying', async () => {
    let resolveRequest: ((result: null) => void) | undefined
    autoUpdaterMock.checkForUpdates.mockImplementationOnce(
      () =>
        new Promise<null>((resolve) => {
          resolveRequest = resolve
        })
    )
    const { handle } = await createUpdater({ feedAvailable: true })
    handle.check()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(handle.getState()).toEqual({ status: 'error' })

    emit('update-available', { version: '2.0.0' })
    emit('update-not-available')
    expect(handle.getState()).toEqual({ status: 'error' })

    handle.check()
    await vi.advanceTimersByTimeAsync(0)
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)

    resolveRequest?.(null)
    await vi.advanceTimersByTimeAsync(0)
    handle.check()
    await vi.advanceTimersByTimeAsync(0)
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(2)
  })
})

describe('readUpdateManifest', () => {
  it('rejects a manifest whose declared size exceeds the limit before reading', async () => {
    const response = new Response('small body', {
      status: 200,
      headers: { 'content-length': String(256 * 1024 + 1) },
    })

    await expect(readUpdateManifest(response)).rejects.toThrow('size limit')
  })

  it('stops a streamed manifest once its body exceeds the limit', async () => {
    const response = new Response(new Uint8Array(256 * 1024 + 1), { status: 200 })

    await expect(readUpdateManifest(response)).rejects.toThrow('size limit')
  })
})

function manifest(version: string, repository = 'simstudioai/sim'): string {
  return [
    `version: ${version}`,
    'files:',
    `  - url: https://github.com/${repository}/releases/download/v${version}/Sim-${version}-universal.zip`,
    '    sha512: abc',
    `  - url: https://github.com/${repository}/releases/download/v${version}/Sim-${version}-universal.dmg`,
    '    sha512: def',
    `path: https://github.com/${repository}/releases/download/v${version}/Sim-${version}-universal.zip`,
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
      platform: 'darwin',
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

  it('rejects a newer version from another update channel', async () => {
    const { handle } = await createManualUpdater(async () =>
      manifest('9.9.9-dev.1', 'simstudioai/sim-desktop-releases')
    )

    handle.check()
    await vi.advanceTimersByTimeAsync(0)

    expect(handle.getState()).toEqual({ status: 'idle', manual: true })
    expect(shell.openExternal).not.toHaveBeenCalled()
  })

  it('rejects an allowed repository asset under a different release tag', async () => {
    const mismatchedTag = manifest('9.9.9').replaceAll('/v9.9.9/', '/v9.9.8/')
    const { handle } = await createManualUpdater(async () => mismatchedTag)

    handle.check()
    await vi.advanceTimersByTimeAsync(0)

    expect(handle.getState()).toMatchObject({ status: 'error', manual: true })
    expect(shell.openExternal).not.toHaveBeenCalled()
  })

  it('rejects unexpected asset names on the expected release', async () => {
    const unexpectedName = manifest('9.9.9').replaceAll('Sim-9.9.9-universal', 'unreviewed-payload')
    const { handle } = await createManualUpdater(async () => unexpectedName)

    handle.check()
    await vi.advanceTimersByTimeAsync(0)

    expect(handle.getState()).toMatchObject({ status: 'error', manual: true })
    expect(shell.openExternal).not.toHaveBeenCalled()
  })

  it('refuses a manifest whose download urls are not http(s)', async () => {
    const hostile = [
      'version: 9.9.9',
      'files:',
      '  - url: smb://attacker.example/share/Sim-9.9.9-universal.dmg',
      '    sha512: abc',
      '  - url: file:///Applications/Calculator.app',
      '    sha512: def',
      "releaseDate: '2026-07-23T00:00:00.000Z'",
    ].join('\n')
    const { handle } = await createManualUpdater(async () => hostile)

    handle.check()
    await vi.advanceTimersByTimeAsync(0)

    // Never advertised, so the user is never offered a Download button for it.
    // 'error' rather than 'idle': a newer version exists but cannot be offered.
    expect(handle.getState()).toMatchObject({ status: 'error', manual: true })

    handle.check()
    handle.install()
    expect(shell.openExternal).not.toHaveBeenCalled()
  })

  it('refuses an attacker-hosted https asset', async () => {
    const offHost = [
      'version: 9.9.9',
      'files:',
      '  - url: https://attacker.example/Sim-9.9.9-universal.dmg',
      '    sha512: abc',
      // A lookalike host must not pass a prefix test either.
      '  - url: https://github.com.evil.example/simstudioai/sim/releases/download/v9.9.9/Sim.dmg',
      '    sha512: def',
      "releaseDate: '2026-07-23T00:00:00.000Z'",
    ].join('\n')
    const { handle } = await createManualUpdater(async () => offHost)

    handle.check()
    await vi.advanceTimersByTimeAsync(0)

    expect(handle.getState()).toMatchObject({ status: 'error', manual: true })
    handle.check()
    handle.install()
    expect(shell.openExternal).not.toHaveBeenCalled()
  })

  it('refuses assets from other repositories on github.com', async () => {
    const offRepository = manifest('9.9.9', 'simstudioai/not-desktop-releases')
    const { handle } = await createManualUpdater(async () => offRepository)

    handle.check()
    await vi.advanceTimersByTimeAsync(0)

    expect(handle.getState()).toMatchObject({ status: 'error', manual: true })
    handle.check()
    handle.install()
    expect(shell.openExternal).not.toHaveBeenCalled()
  })
})

describe('checkForUpdatesInteractive', () => {
  const events = { record: vi.fn(), filePath: '/tmp/desktop-events.log' }

  async function _manualHandle(version: string) {
    const handle = initUpdater({
      getWindow: () => null,
      events,
      appOrigin: () => 'https://www.dev.sim.ai',
      canSelfUpdate: async () => false,
      fetchManifest: async () => manifest(version),
      platform: 'darwin',
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

  it('fails a hung interactive check after twelve seconds instead of waiting thirty', async () => {
    const handle: UpdaterHandle = {
      setAutoDownload: () => {},
      getState: () => ({ status: 'checking' }),
      check: vi.fn(),
      install: vi.fn(),
      onState: () => () => {},
    }

    checkForUpdatesInteractive({ getWindow: () => null, events, handle })
    await vi.advanceTimersByTimeAsync(12_000)

    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Could not check for updates' })
    )
  })
})
