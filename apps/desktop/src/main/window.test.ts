import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import {
  backgroundColorFor,
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
})
