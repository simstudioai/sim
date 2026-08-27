import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { BrowserWindow, dialog, systemPreferences } from 'electron'
import type { ConfigStore } from '@/main/config'
import type { EventRecorder } from '@/main/observability'
import {
  backgroundColorFor,
  createMainWindow,
  createSecureWebPreferences,
  ensureMicrophoneAccess,
  resolvePermission,
  sanitizeBounds,
  setupPermissionHandlers,
} from '@/main/window'

const APP = 'https://sim.ai'

describe('resolvePermission', () => {
  it('allows sanitized clipboard writes from the trusted origin', () => {
    expect(resolvePermission('clipboard-sanitized-write', APP, APP)).toBe(true)
    expect(resolvePermission('clipboard-sanitized-write', 'https://evil.example', APP)).toBe(false)
    expect(resolvePermission('clipboard-sanitized-write', '', APP)).toBe(false)
  })

  it('allows clipboard reads from the trusted origin only, so terminal Paste works', () => {
    expect(resolvePermission('clipboard-read', APP, APP)).toBe(true)
    expect(resolvePermission('clipboard-read', 'https://evil.example', APP)).toBe(false)
    expect(resolvePermission('clipboard-read', '', APP)).toBe(false)
  })

  it('allows audio-only media from the trusted origin, so voice input works', () => {
    expect(resolvePermission('media', APP, APP, ['audio'])).toBe(true)
    expect(resolvePermission('media', 'https://evil.example', APP, ['audio'])).toBe(false)
    expect(resolvePermission('media', '', APP, ['audio'])).toBe(false)
  })

  it('denies media that is not narrowed to audio', () => {
    expect(resolvePermission('media', APP, APP, ['video'])).toBe(false)
    expect(resolvePermission('media', APP, APP, ['audio', 'video'])).toBe(false)
    expect(resolvePermission('media', APP, APP, ['unknown'])).toBe(false)
    expect(resolvePermission('media', APP, APP, [])).toBe(false)
    expect(resolvePermission('media', APP, APP)).toBe(false)
  })

  it('default-denies everything else, including unknown future permissions', () => {
    for (const permission of [
      'geolocation',
      'notifications',
      'camera',
      'display-capture',
      'midi',
      'pointerLock',
      'openExternal',
      'some-future-permission',
    ]) {
      expect(resolvePermission(permission, APP, APP)).toBe(false)
      expect(resolvePermission(permission, APP, APP, ['audio'])).toBe(false)
    }
  })
})

describe('ensureMicrophoneAccess', () => {
  const realPlatform = process.platform

  function setPlatform(platform: NodeJS.Platform) {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  }

  beforeEach(() => {
    vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('granted')
    vi.mocked(systemPreferences.askForMediaAccess).mockResolvedValue(true)
  })

  afterEach(() => {
    setPlatform(realPlatform)
    vi.clearAllMocks()
  })

  it('skips the OS check off macOS, where there is no TCC gate', async () => {
    setPlatform('win32')
    await expect(ensureMicrophoneAccess()).resolves.toBe(true)
    expect(systemPreferences.getMediaAccessStatus).not.toHaveBeenCalled()
  })

  it('raises the macOS prompt when access has never been decided', async () => {
    setPlatform('darwin')
    vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('not-determined')
    await expect(ensureMicrophoneAccess()).resolves.toBe(true)
    expect(systemPreferences.askForMediaAccess).toHaveBeenCalledWith('microphone')
  })

  it('does not re-prompt once macOS already granted access', async () => {
    setPlatform('darwin')
    await expect(ensureMicrophoneAccess()).resolves.toBe(true)
    expect(systemPreferences.askForMediaAccess).not.toHaveBeenCalled()
  })

  it('reports a blocked microphone without prompting, since macOS would not show one', async () => {
    setPlatform('darwin')
    vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('denied')
    await expect(ensureMicrophoneAccess()).resolves.toBe(false)
    expect(systemPreferences.askForMediaAccess).not.toHaveBeenCalled()
  })

  it('denies when the OS request itself fails', async () => {
    setPlatform('darwin')
    vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('not-determined')
    vi.mocked(systemPreferences.askForMediaAccess).mockRejectedValue(new Error('boom'))
    await expect(ensureMicrophoneAccess()).resolves.toBe(false)
  })
})

describe('setupPermissionHandlers', () => {
  const realPlatform = process.platform

  function createSession() {
    const session = {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
    }
    setupPermissionHandlers(session as never, () => APP)
    return {
      request: session.setPermissionRequestHandler.mock.calls[0][0] as (
        contents: unknown,
        permission: string,
        callback: (granted: boolean) => void,
        details: Record<string, unknown>
      ) => void,
      check: session.setPermissionCheckHandler.mock.calls[0][0] as (
        contents: unknown,
        permission: string,
        requestingOrigin: string,
        details: Record<string, unknown>
      ) => boolean,
    }
  }

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
    vi.clearAllMocks()
  })

  it('grants a microphone request only after the OS agrees', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('denied')
    const { request } = createSession()
    const callback = vi.fn()

    request(null, 'media', callback, { requestingUrl: `${APP}/workspace`, mediaTypes: ['audio'] })
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(false))

    vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('granted')
    request(null, 'media', callback, { requestingUrl: `${APP}/workspace`, mediaTypes: ['audio'] })
    await vi.waitFor(() => expect(callback).toHaveBeenLastCalledWith(true))
  })

  it('rejects a camera request without touching the OS', () => {
    const { request } = createSession()
    const callback = vi.fn()

    request(null, 'media', callback, { requestingUrl: `${APP}/workspace`, mediaTypes: ['video'] })

    expect(callback).toHaveBeenCalledWith(false)
    expect(systemPreferences.getMediaAccessStatus).not.toHaveBeenCalled()
  })

  it('answers a clipboard request synchronously', () => {
    const { request } = createSession()
    const callback = vi.fn()

    request(null, 'clipboard-read', callback, { requestingUrl: `${APP}/workspace` })

    expect(callback).toHaveBeenCalledWith(true)
  })

  it('reports microphone as permitted on the check path', () => {
    const { check } = createSession()

    expect(check(null, 'media', APP, { mediaType: 'audio' })).toBe(true)
    expect(check(null, 'media', APP, { mediaType: 'video' })).toBe(false)
    expect(check(null, 'media', APP, {})).toBe(false)
    expect(check(null, 'media', 'https://evil.example', { mediaType: 'audio' })).toBe(false)
  })
})

describe('backgroundColorFor', () => {
  it('matches the persisted web-app theme', () => {
    expect(backgroundColorFor('dark', false)).toBe('#0c0c0c')
    expect(backgroundColorFor('light', true)).toBe('#ffffff')
  })

  it('falls back to the system theme before first capture', () => {
    expect(backgroundColorFor(undefined, true)).toBe('#0c0c0c')
    expect(backgroundColorFor(undefined, false)).toBe('#ffffff')
  })
})

describe('sanitizeBounds', () => {
  it('passes plausible bounds through', () => {
    const bounds = { x: 20, y: 40, width: 1200, height: 800 }
    expect(sanitizeBounds(bounds)).toEqual(bounds)
  })

  it('drops implausible or malformed bounds', () => {
    expect(sanitizeBounds(undefined)).toBeUndefined()
    expect(sanitizeBounds({ width: 10, height: 10 })).toBeUndefined()
    expect(sanitizeBounds({ width: Number.NaN, height: 800 })).toBeUndefined()
  })

  it('drops only the position when coordinates are malformed', () => {
    expect(sanitizeBounds({ x: Number.NaN, y: 0, width: 1200, height: 800 })).toEqual({
      width: 1200,
      height: 800,
    })
  })
})

describe('createSecureWebPreferences', () => {
  it('locks down the renderer', () => {
    const prefs = createSecureWebPreferences('persist:sim', '/tmp/preload.cjs', true)
    expect(prefs).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      devTools: false,
      partition: 'persist:sim',
      preload: '/tmp/preload.cjs',
    })
  })

  it('enables DevTools only for unpackaged builds', () => {
    expect(createSecureWebPreferences('persist:sim', '/p', false).devTools).toBe(true)
  })

  it('passes the shell version to the preload as an argv flag', () => {
    expect(createSecureWebPreferences('persist:sim', '/p', true).additionalArguments).toEqual([
      '--sim-desktop-version=1.0.0',
    ])
  })
})

describe('createMainWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function createTestWindow() {
    const config = {
      filePath: '/tmp/settings.json',
      getOrigin: vi.fn(() => APP),
      setOrigin: vi.fn(),
      get: vi.fn(() => undefined),
      set: vi.fn(),
    } as unknown as ConfigStore
    const events = {
      filePath: '/tmp/events.jsonl',
      record: vi.fn(),
    } satisfies EventRecorder
    const win = createMainWindow({
      config,
      events,
      appOrigin: () => APP,
      partition: 'persist:sim',
      preloadPath: '/tmp/preload.cjs',
      isPackaged: false,
      onClosed: vi.fn(),
    })
    const contentHandlers = new Map(
      vi.mocked(win.webContents.on).mock.calls as unknown as Array<
        [string, (...args: never[]) => unknown]
      >
    )
    return { events, win, contentHandlers }
  }

  it('makes Stay the safe keyboard default for beforeunload', () => {
    const { contentHandlers } = createTestWindow()
    const handler = contentHandlers.get('will-prevent-unload')
    const event = { preventDefault: vi.fn() }

    vi.mocked(dialog.showMessageBoxSync).mockReturnValueOnce(0)
    handler?.(event as never)

    expect(dialog.showMessageBoxSync).toHaveBeenCalledWith(
      expect.any(BrowserWindow),
      expect.objectContaining({
        buttons: ['Stay', 'Leave'],
        defaultId: 0,
        cancelId: 0,
      })
    )
    expect(event.preventDefault).not.toHaveBeenCalled()

    vi.mocked(dialog.showMessageBoxSync).mockReturnValueOnce(1)
    handler?.(event as never)
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('queues crash recovery behind an open hang dialog without stacking dialogs', async () => {
    let resolveHang: ((value: { response: number; checkboxChecked: boolean }) => void) | undefined
    vi.mocked(dialog.showMessageBox)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveHang = resolve
          })
      )
      .mockResolvedValue({ response: 0, checkboxChecked: false })
    const { contentHandlers, events } = createTestWindow()

    contentHandlers.get('unresponsive')?.()
    contentHandlers.get('render-process-gone')?.(
      undefined as never,
      { reason: 'crashed', exitCode: 9 } as never
    )
    contentHandlers.get('render-process-gone')?.(
      undefined as never,
      { reason: 'crashed', exitCode: 9 } as never
    )

    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1)
    expect(events.record).toHaveBeenCalledWith('renderer_unresponsive')
    expect(events.record).toHaveBeenCalledWith('renderer_gone', expect.any(Object))
    expect(events.record).toHaveBeenCalledTimes(2)

    resolveHang?.({ response: 0, checkboxChecked: false })
    await vi.waitFor(() => expect(dialog.showMessageBox).toHaveBeenCalledTimes(2))
  })

  it('keeps the native macOS fullscreen titlebar blank', () => {
    const config = {
      filePath: '/tmp/settings.json',
      getOrigin: vi.fn(() => APP),
      setOrigin: vi.fn(),
      get: vi.fn(() => undefined),
      set: vi.fn(),
    } as unknown as ConfigStore
    const events = {
      filePath: '/tmp/events.jsonl',
      record: vi.fn(),
    } satisfies EventRecorder

    const win = createMainWindow({
      config,
      events,
      appOrigin: () => APP,
      partition: 'persist:sim',
      preloadPath: '/tmp/preload.cjs',
      isPackaged: false,
      onClosed: vi.fn(),
      platform: 'darwin',
    })

    const MockBrowserWindow = BrowserWindow as typeof BrowserWindow & {
      lastOptions?: Record<string, unknown>
    }
    const windowEventCalls = vi.mocked(win.on).mock.calls as unknown as Array<
      [string, (...args: unknown[]) => unknown]
    >

    expect(MockBrowserWindow.lastOptions?.title).toBe('Sim')
    // The overlay is what publishes `titlebar-area-*` to the page, so the web
    // app can reserve the traffic-light lane from the platform rather than from
    // pixels that shrink under page zoom while the OS-drawn lights do not.
    expect(MockBrowserWindow.lastOptions).toMatchObject({
      titleBarStyle: 'hiddenInset',
      titleBarOverlay: true,
      trafficLightPosition: { x: 12, y: 12 },
    })

    const pageTitleHandler = windowEventCalls.find(
      ([event]) => event === 'page-title-updated'
    )?.[1] as ((event: { preventDefault: () => void }) => void) | undefined
    const enterFullscreenHandler = windowEventCalls.find(
      ([event]) => event === 'enter-full-screen'
    )?.[1] as (() => void) | undefined
    const leaveFullscreenHandler = windowEventCalls.find(
      ([event]) => event === 'leave-full-screen'
    )?.[1] as (() => void) | undefined

    enterFullscreenHandler?.()
    expect(win.setTitle).toHaveBeenLastCalledWith('')

    vi.mocked(win.isFullScreen).mockReturnValue(true)
    const event = { preventDefault: vi.fn() }
    pageTitleHandler?.(event)

    expect(pageTitleHandler).toBeTypeOf('function')
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(win.setTitle).toHaveBeenLastCalledWith('')

    leaveFullscreenHandler?.()
    expect(win.setTitle).toHaveBeenLastCalledWith('Sim')
  })

  it('lets the OS cascade secondary windows instead of reusing the saved position', () => {
    const config = {
      filePath: '/tmp/settings.json',
      getOrigin: vi.fn(() => APP),
      setOrigin: vi.fn(),
      get: vi.fn(() => ({ x: 40, y: 60, width: 1200, height: 800 })),
      set: vi.fn(),
    } as unknown as ConfigStore
    const events = {
      filePath: '/tmp/events.jsonl',
      record: vi.fn(),
    } satisfies EventRecorder

    createMainWindow({
      config,
      events,
      appOrigin: () => APP,
      partition: 'persist:sim',
      preloadPath: '/tmp/preload.cjs',
      isPackaged: false,
      onClosed: vi.fn(),
      restorePosition: false,
    })

    const MockBrowserWindow = BrowserWindow as typeof BrowserWindow & {
      lastOptions?: Record<string, unknown>
    }
    expect(MockBrowserWindow.lastOptions).toMatchObject({ width: 1200, height: 800 })
    expect(MockBrowserWindow.lastOptions?.x).toBeUndefined()
    expect(MockBrowserWindow.lastOptions?.y).toBeUndefined()
  })
})
