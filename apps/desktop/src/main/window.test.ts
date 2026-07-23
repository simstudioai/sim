import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { BrowserWindow } from 'electron'
import type { ConfigStore } from '@/main/config'
import type { EventRecorder } from '@/main/observability'
import {
  backgroundColorFor,
  createMainWindow,
  createSecureWebPreferences,
  resolvePermission,
  sanitizeBounds,
} from '@/main/window'

const APP = 'https://sim.ai'

describe('resolvePermission', () => {
  it('allows audio capture from the trusted origin only', () => {
    expect(resolvePermission('media', APP, APP, ['audio'])).toBe(true)
    expect(resolvePermission('media', 'https://evil.example', APP, ['audio'])).toBe(false)
    expect(resolvePermission('media', '', APP, ['audio'])).toBe(false)
  })

  it('denies any video capture', () => {
    expect(resolvePermission('media', APP, APP, ['video'])).toBe(false)
    expect(resolvePermission('media', APP, APP, ['audio', 'video'])).toBe(false)
  })

  it('default-denies media when the request carries no explicit audio type', () => {
    expect(resolvePermission('media', APP, APP)).toBe(false)
    expect(resolvePermission('media', APP, APP, [])).toBe(false)
    expect(resolvePermission('media', APP, APP, ['unknown'])).toBe(false)
  })

  it('allows sanitized clipboard writes from the trusted origin', () => {
    expect(resolvePermission('clipboard-sanitized-write', APP, APP)).toBe(true)
    expect(resolvePermission('clipboard-sanitized-write', 'https://evil.example', APP)).toBe(false)
  })

  it('default-denies everything else, including unknown future permissions', () => {
    for (const permission of [
      'geolocation',
      'notifications',
      'camera',
      'midi',
      'pointerLock',
      'openExternal',
      'some-future-permission',
    ]) {
      expect(resolvePermission(permission, APP, APP)).toBe(false)
    }
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
})
