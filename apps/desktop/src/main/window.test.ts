import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSecureWebPreferences } from '@/main/window-preferences'

vi.mock('electron', () => import('@/test/electron-mock'))

import {
  BrowserWindow,
  dialog,
  nativeTheme,
  screen,
  systemPreferences,
  WebContentsView,
} from 'electron'
import { registerAgentWebContents } from '@/main/browser-agent/registry'
import type { ConfigStore } from '@/main/config'
import type { EventRecorder } from '@/main/observability'
import {
  createMainWindow,
  handleSecondInstance,
  resolvePermission,
  setupPermissionHandlers,
} from '@/main/window'

const APP = 'https://sim.ai'

describe('resolvePermission', () => {
  it('allows sanitized clipboard writes from the trusted origin', () => {
    expect(resolvePermission('clipboard-sanitized-write', APP, APP)).toBe(true)
    expect(resolvePermission('clipboard-sanitized-write', 'https://evil.example', APP)).toBe(false)
    expect(resolvePermission('clipboard-sanitized-write', '', APP)).toBe(false)
  })

  it('denies clipboard reads, including from the trusted origin', () => {
    expect(resolvePermission('clipboard-read', APP, APP)).toBe(false)
    expect(resolvePermission('clipboard-read', 'https://evil.example', APP)).toBe(false)
    expect(resolvePermission('clipboard-read', '', APP)).toBe(false)
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

  it('keeps browser permission prompts when a Sim page shares the app session', () => {
    const { request, check } = createSession()
    const contents = new WebContentsView().webContents
    const browserRequest = vi.fn((_contents, _permission, callback) => callback(false))
    const browserCheck = vi.fn(() => false)
    registerAgentWebContents(contents, APP, { request: browserRequest, check: browserCheck })
    const callback = vi.fn()
    request(contents, 'media', callback, { requestingUrl: `${APP}/chat`, mediaTypes: ['audio'] })
    expect(browserRequest).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledWith(false)
    expect(check(contents, 'media', APP, { mediaType: 'audio' })).toBe(false)
    expect(browserCheck).toHaveBeenCalledOnce()
    expect(systemPreferences.getMediaAccessStatus).not.toHaveBeenCalled()
    expect(check(null, 'media', APP, { mediaType: 'audio' })).toBe(true)
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
})

describe('createMainWindow', () => {
  beforeEach(() => {
    vi.mocked(screen.getDisplayMatching).mockReturnValue({
      workArea: { x: 0, y: 0, width: 1440, height: 900 },
    } as never)
  })

  function createTestWindow(
    isCommittedRelaunchPending: () => boolean = () => false,
    platform?: NodeJS.Platform
  ) {
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
      isCommittedRelaunchPending,
      platform,
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

  describe('native theme on Windows', () => {
    afterEach(() => {
      nativeTheme.themeSource = 'system'
    })

    function reportTheme(platform: NodeJS.Platform) {
      const { win } = createTestWindow(undefined, platform)
      Object.defineProperty(win.webContents.mainFrame, 'url', { value: `${APP}/workspace` })
      const handler = new Map(
        vi.mocked(win.webContents.ipc.on).mock.calls as unknown as Array<
          [string, (event: unknown, theme: unknown, preference?: unknown) => void]
        >
      ).get('shell:app-theme')
      if (!handler) throw new Error('shell:app-theme handler not registered')
      const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame }
      return (theme: string, preference?: string) => handler(event, theme, preference)
    }

    it('never pins the OS theme from a resolved theme alone', () => {
      // Pinning would also pin prefers-color-scheme and freeze a Sim that follows the system.
      reportTheme('win32')('light')
      expect(nativeTheme.themeSource).toBe('system')
    })

    it('follows an explicit choice and releases it when Sim follows the system again', () => {
      const report = reportTheme('win32')
      report('dark', 'dark')
      expect(nativeTheme.themeSource).toBe('dark')
      report('dark', 'system')
      expect(nativeTheme.themeSource).toBe('system')
    })

    it('leaves macOS appearance alone', () => {
      reportTheme('darwin')('dark', 'dark')
      expect(nativeTheme.themeSource).toBe('system')
    })
  })
})

describe('handleSecondInstance', () => {
  function deps(platform: NodeJS.Platform) {
    const existing = new BrowserWindow()
    return {
      existing,
      ensureMainWindow: vi.fn(() => Promise.resolve(existing)),
      createWindow: vi.fn(() => Promise.resolve(new BrowserWindow())),
      showWindow: vi.fn(),
      platform,
    }
  }

  it('surfaces the running window on Windows instead of opening another', async () => {
    const d = deps('win32')
    await handleSecondInstance(d)
    expect(d.createWindow).not.toHaveBeenCalled()
    expect(d.showWindow).toHaveBeenCalledWith(d.existing)
  })

  it('still opens another window for an explicit extra launch on macOS', async () => {
    const d = deps('darwin')
    await handleSecondInstance(d)
    expect(d.createWindow).toHaveBeenCalledOnce()
    expect(d.showWindow).not.toHaveBeenCalled()
  })
})
