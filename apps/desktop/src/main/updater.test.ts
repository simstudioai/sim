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

import { app, dialog, shell } from 'electron'
import {
  checkForUpdatesInteractive,
  feedUrlForOrigin,
  initUpdater,
  isDowngrade,
  isNewerVersion,
  parseSemver,
  readUpdateManifest,
  resolveUpdateChannel,
  type UpdaterHandle,
  updateCheckIntervalMs,
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

  it('keeps legacy alpha and beta builds on their environment streams', () => {
    expect(resolveUpdateChannel('1.2.3-alpha.2')).toBe('dev')
    expect(resolveUpdateChannel('1.2.3-beta.1')).toBe('staging')
  })
})

describe('updateCheckIntervalMs', () => {
  it('checks dev and staging builds every five minutes', () => {
    expect(updateCheckIntervalMs('1.2.3-dev.2')).toBe(5 * 60 * 1000)
    expect(updateCheckIntervalMs('1.2.3-staging.1')).toBe(5 * 60 * 1000)
  })

  it('checks production builds every thirty minutes', () => {
    expect(updateCheckIntervalMs('1.2.3')).toBe(30 * 60 * 1000)
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
    expect(parseSemver('1.2.3garbage')).toBeNull()
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

  async function createUpdater(options?: {
    autoDownload?: boolean
    feedAvailable?: boolean | 'no-release'
    probeOriginFeed?: (feedUrl: string) => Promise<boolean | 'no-release'>
    beforeInstall?: () => Promise<void>
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
    autoUpdaterMock.checkForUpdates.mockImplementation(() => new Promise(() => {}))
    autoUpdaterMock.downloadUpdate.mockClear()
    autoUpdaterMock.quitAndInstall.mockClear()
    autoUpdaterMock.autoRunAppAfterInstall = false
    updaterChannel = ''
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

    handle.install()
    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('downloads, installs, and relaunches from one Update action', async () => {
    autoUpdaterMock.autoDownload = false
    const { handle } = await createUpdater({ autoDownload: false })

    handle.check()
    await vi.advanceTimersByTimeAsync(0)
    emit('update-available', { version: '2.0.0' })
    expect(handle.getState()).toEqual({ status: 'available', version: '2.0.0' })

    handle.check()
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(handle.getState()).toEqual({ status: 'downloading', version: '2.0.0' })

    handle.check()
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(1)
    emit('download-progress', { percent: 41.7 })
    expect(handle.getState()).toEqual({ status: 'downloading', version: '2.0.0', percent: 42 })

    emit('update-downloaded', { version: '2.0.0' })
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
    expect(autoUpdaterMock.autoRunAppAfterInstall).toBe(true)
    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('surfaces a manually started download failure without installing', async () => {
    autoUpdaterMock.downloadUpdate.mockRejectedValueOnce(new Error('download failed'))
    const { handle } = await createUpdater({ autoDownload: false })

    handle.check()
    await vi.advanceTimersByTimeAsync(0)
    emit('update-available', { version: '2.0.0' })
    handle.check()
    await vi.advanceTimersByTimeAsync(0)

    expect(handle.getState()).toEqual({ status: 'error', version: '2.0.0' })
    emit('update-downloaded', { version: '2.0.0' })
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
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
    await vi.advanceTimersByTimeAsync(0)

    expect(beforeInstall).toHaveBeenCalledTimes(1)
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()

    finishTeardown?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('does not install when pre-install teardown fails', async () => {
    const beforeInstall = vi.fn(async () => {
      throw new Error('flush failed')
    })
    const { handle } = await createUpdater({ beforeInstall })

    handle.check()
    await vi.advanceTimersByTimeAsync(0)
    emit('update-available', { version: '2.0.0' })
    emit('update-downloaded', { version: '2.0.0' })
    handle.install()
    await vi.advanceTimersByTimeAsync(0)

    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(false)
    expect(handle.getState()).toEqual({ status: 'error', version: '2.0.0' })
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

  it('does not lose an interactive check while updater capability is initializing', async () => {
    let resolveCapability: ((capable: boolean) => void) | undefined
    const capability = new Promise<boolean>((resolve) => {
      resolveCapability = resolve
    })
    const states: DesktopUpdateState[] = []
    const handle = initUpdater({
      getWindow: () => null,
      events,
      appOrigin: () => 'https://www.dev.sim.ai',
      onStateChange: (state) => states.push(state),
      loadAutoUpdater: () =>
        autoUpdaterMock as unknown as typeof import('electron-updater')['autoUpdater'],
      probeOriginFeed: async () => true,
      canSelfUpdate: () => capability,
      platform: 'darwin',
    })

    handle.check()
    expect(states).toEqual([{ status: 'checking' }])

    resolveCapability?.(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
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

  it('surfaces updater errors and recovers via update-not-available', async () => {
    const { handle } = await createUpdater()
    handle.check()
    await vi.advanceTimersByTimeAsync(0)
    emit('error', new Error('feed unreachable'))
    expect(handle.getState()).toEqual({ status: 'error' })
    handle.check()
    await vi.advanceTimersByTimeAsync(0)
    emit('update-not-available')
    expect(handle.getState()).toEqual({ status: 'idle' })
  })

  it('switches to the per-env origin feed when the origin serves one', async () => {
    const { handle } = await createUpdater({ feedAvailable: true })
    handle.check()
    await vi.advanceTimersByTimeAsync(0)
    expect(autoUpdaterMock.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'https://www.dev.sim.ai/api/desktop/update',
      channel: 'latest',
    })
    expect(autoUpdaterMock.channel).toBe('latest')
    expect(autoUpdaterMock.allowDowngrade).toBe(false)
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
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(false)
    expect(events.record).toHaveBeenCalledWith('update_blocked_version', {
      version: '2.0.0',
      reason: 'unusable-url',
    })
  })

  it('keeps the packaged GitHub feed when the origin has no feed', async () => {
    const { handle } = await createUpdater({ feedAvailable: false })
    handle.check()
    await vi.advanceTimersByTimeAsync(0)
    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled()
  })

  it('completes an interactive check immediately when the environment has no release', async () => {
    const { handle, states } = await createUpdater({ feedAvailable: 'no-release' })

    handle.check()
    await vi.advanceTimersByTimeAsync(0)

    expect(states).toEqual([{ status: 'checking' }, { status: 'idle' }])
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
  })

  it('re-probes a no-release environment so a newly published update appears without restart', async () => {
    const probeOriginFeed = vi
      .fn<(feedUrl: string) => Promise<boolean | 'no-release'>>()
      .mockResolvedValueOnce('no-release')
      .mockResolvedValueOnce(true)
    const { handle } = await createUpdater({ probeOriginFeed })

    handle.check()
    await vi.advanceTimersByTimeAsync(0)
    expect(handle.getState()).toEqual({ status: 'idle' })
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()

    handle.check()
    await vi.advanceTimersByTimeAsync(0)
    expect(probeOriginFeed).toHaveBeenCalledTimes(2)
    expect(autoUpdaterMock.setFeedURL).toHaveBeenCalledTimes(1)
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('recovers an interactive check when the feed probe times out', async () => {
    const probeOriginFeed = vi.fn(() => new Promise<boolean>(() => {}))
    const { handle } = await createUpdater({ probeOriginFeed })

    handle.check()
    expect(handle.getState()).toEqual({ status: 'checking' })
    await vi.advanceTimersByTimeAsync(10_000)

    expect(handle.getState()).toEqual({ status: 'error' })
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
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

  it('gives the updater request a fresh timeout after a slow feed probe', async () => {
    let resolveProbe: ((available: boolean) => void) | undefined
    const probeOriginFeed = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveProbe = resolve
        })
    )
    const { handle } = await createUpdater({ probeOriginFeed })

    handle.check()
    await vi.advanceTimersByTimeAsync(9_000)
    resolveProbe?.(true)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(9_999)
    expect(handle.getState()).toEqual({ status: 'checking' })

    await vi.advanceTimersByTimeAsync(1)
    expect(handle.getState()).toEqual({ status: 'error' })
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

  it('does not initialize the updater outside macOS', () => {
    const loadAutoUpdater = vi.fn(
      () => autoUpdaterMock as unknown as typeof import('electron-updater')['autoUpdater']
    )
    const handle = initUpdater({
      getWindow: () => null,
      events,
      appOrigin: () => 'https://sim.ai',
      loadAutoUpdater,
      platform: 'win32',
    })

    handle.check()
    expect(loadAutoUpdater).not.toHaveBeenCalled()
    expect(handle.getState()).toEqual({ status: 'idle' })
  })

  it('fails interactive checks promptly on prerelease builds when the origin feed is down', async () => {
    // The GitHub fallback is stable-only: a Sim Dev shell can never apply a
    // prod-identity artifact, so it must not check against it.
    vi.mocked(app.getVersion).mockReturnValue('1.0.1-dev.7')
    try {
      const { handle } = await createUpdater({ feedAvailable: false })
      handle.check()
      await vi.advanceTimersByTimeAsync(0)
      expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
      expect(handle.getState()).toEqual({ status: 'error' })
    } finally {
      vi.mocked(app.getVersion).mockReturnValue('1.0.0')
    }
  })

  it('checks prerelease builds normally through the origin feed', async () => {
    vi.mocked(app.getVersion).mockReturnValue('1.0.1-dev.7')
    try {
      const { handle } = await createUpdater({ feedAvailable: true })
      handle.check()
      await vi.advanceTimersByTimeAsync(0)
      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
    } finally {
      vi.mocked(app.getVersion).mockReturnValue('1.0.0')
    }
  })

  it.each([
    ['1.0.1-dev.7', 5 * 60 * 1000],
    ['1.0.1-staging.7', 5 * 60 * 1000],
    ['1.0.1', 30 * 60 * 1000],
  ])('schedules %s update polling every %i milliseconds', async (version, interval) => {
    vi.mocked(app.getVersion).mockReturnValue(version)
    const intervalSpy = vi.spyOn(globalThis, 'setInterval')
    try {
      await createUpdater({ feedAvailable: true })
      expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), interval)
    } finally {
      intervalSpy.mockRestore()
      vi.mocked(app.getVersion).mockReturnValue('1.0.0')
    }
  })
})

describe('readUpdateManifest', () => {
  it('streams a manifest within the byte limit', async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('version: '))
          controller.enqueue(new TextEncoder().encode('1.2.3'))
          controller.close()
        },
      }),
      { status: 200 }
    )

    await expect(readUpdateManifest(response)).resolves.toBe('version: 1.2.3')
  })

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

  it('does not read an unsuccessful response body', async () => {
    const response = new Response('not found', { status: 404 })

    await expect(readUpdateManifest(response)).resolves.toBeNull()
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

  it('offers prerelease-repository assets as manual downloads', async () => {
    vi.mocked(app.getVersion).mockReturnValue('1.0.0-dev.1')
    const fetchManifest = vi.fn(async () =>
      manifest('9.9.9-dev.1', 'simstudioai/sim-desktop-releases')
    )
    try {
      const { handle } = await createManualUpdater(fetchManifest)

      handle.check()
      await vi.advanceTimersByTimeAsync(0)
      expect(handle.getState()).toEqual({
        status: 'available',
        version: '9.9.9-dev.1',
        manual: true,
      })

      handle.check()
      expect(shell.openExternal).toHaveBeenCalledWith(
        'https://github.com/simstudioai/sim-desktop-releases/releases/download/v9.9.9-dev.1/Sim-9.9.9-dev.1-universal.dmg'
      )
    } finally {
      vi.mocked(app.getVersion).mockReturnValue('1.0.0')
    }
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

  it('ignores a manifest that arrives after the manual check timeout', async () => {
    let resolveManifest: ((manifestBody: string) => void) | undefined
    const { handle } = await createManualUpdater(
      () =>
        new Promise<string>((resolve) => {
          resolveManifest = resolve
        })
    )

    handle.check()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(handle.getState()).toEqual({ status: 'error', manual: true })

    resolveManifest?.(manifest('9.9.9'))
    await vi.advanceTimersByTimeAsync(0)
    expect(handle.getState()).toEqual({ status: 'error', manual: true })
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

  it('skips an unusable url but still offers a safe one from the same manifest', async () => {
    const mixed = [
      'version: 9.9.9',
      'files:',
      '  - url: javascript:alert(1)//Sim-9.9.9-universal.dmg',
      '    sha512: abc',
      '  - url: https://github.com/simstudioai/sim/releases/download/v9.9.9/Sim-9.9.9-universal.dmg',
      '    sha512: def',
      "releaseDate: '2026-07-23T00:00:00.000Z'",
    ].join('\n')
    const { handle } = await createManualUpdater(async () => mixed)

    handle.check()
    await vi.advanceTimersByTimeAsync(0)
    expect(handle.getState()).toEqual({ status: 'available', version: '9.9.9', manual: true })

    handle.check()
    expect(shell.openExternal).toHaveBeenCalledWith(
      'https://github.com/simstudioai/sim/releases/download/v9.9.9/Sim-9.9.9-universal.dmg'
    )
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
      expect.objectContaining({
        type: 'info',
        buttons: ['OK'],
        defaultId: 0,
        message: 'You’re up to date!',
        detail: `Sim ${app.getVersion()} is currently the newest version available.`,
      })
    )
    expect(shell.openExternal).not.toHaveBeenCalled()
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

  it('only explains packaged-build updates when unpackaged', async () => {
    ;(app as unknown as { isPackaged: boolean }).isPackaged = false
    checkForUpdatesInteractive({ getWindow: () => null, events, handle: null })
    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Updates are only available in packaged builds' })
    )
  })
})
