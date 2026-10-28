import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSecureWebPreferences } from '@/main/window-preferences'

vi.mock('electron', () => import('@/test/electron-mock'))

import { BrowserWindow, dialog, screen, systemPreferences, WebContentsView } from 'electron'
import { registerAgentWebContents } from '@/main/browser-agent/registry'
import type { ConfigStore } from '@/main/config'
import type { EventRecorder } from '@/main/observability'
import { createMainWindow, resolvePermission, setupPermissionHandlers } from '@/main/window'

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

  function createTestWindow(isCommittedRelaunchPending: () => boolean = () => false) {
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
})
