import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import type { ConfigStore, OriginValidation } from '@/main/config'
import { createServerWindow, type ServerWindowDeps } from '@/main/server-window'

const CURRENT = 'https://sim.example.com'
const DEFAULT = 'https://www.sim.ai'

function makeConfig(origin: string, validate: (raw: string) => OriginValidation): ConfigStore {
  let stored = origin
  return {
    filePath: '/tmp/settings.json',
    getOrigin: () => stored,
    setOrigin: vi.fn((raw: string) => {
      const result = validate(raw)
      if (result.ok) stored = result.origin
      return result
    }),
    get: vi.fn(() => undefined),
    set: vi.fn(),
    flush: vi.fn(),
  } as unknown as ConfigStore
}

function makeDeps(overrides: Partial<ServerWindowDeps> = {}): ServerWindowDeps {
  return {
    config: makeConfig(CURRENT, (raw) =>
      raw.startsWith('https://') ? { ok: true, origin: raw } : { ok: false, error: 'bad origin' }
    ),
    defaultOrigin: DEFAULT,
    preloadPath: '/tmp/preload.cjs',
    isPackaged: false,
    getParentWindow: () => null,
    relaunch: vi.fn(),
    ...overrides,
  }
}

describe('server window', () => {
  let deps: ServerWindowDeps

  beforeEach(() => {
    deps = makeDeps()
  })

  it('reports the configured origin alongside the build default', () => {
    expect(createServerWindow(deps).getConfiguration()).toEqual({
      origin: CURRENT,
      defaultOrigin: DEFAULT,
    })
  })

  it('relaunches after storing a different origin', () => {
    const result = createServerWindow(deps).setOrigin('https://sim.other.example')

    expect(result).toEqual({ ok: true, origin: 'https://sim.other.example', unchanged: false })
    expect(deps.config.flush).toHaveBeenCalled()
    expect(deps.relaunch).toHaveBeenCalledTimes(1)
  })

  // Re-confirming the URL already in the field is the most likely thing a user
  // does in this window; restarting the app for it would be pure disruption.
  it('does not relaunch when the origin is unchanged', () => {
    const result = createServerWindow(deps).setOrigin(CURRENT)

    expect(result).toEqual({ ok: true, origin: CURRENT, unchanged: true })
    expect(deps.relaunch).not.toHaveBeenCalled()
  })

  it('surfaces a rejected origin without relaunching', () => {
    const result = createServerWindow(deps).setOrigin('ftp://sim.example.com')

    expect(result).toEqual({ ok: false, error: 'bad origin' })
    expect(deps.relaunch).not.toHaveBeenCalled()
    expect(deps.config.getOrigin()).toBe(CURRENT)
  })
})
