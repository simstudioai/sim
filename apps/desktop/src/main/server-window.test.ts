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
    pagePath: 'static/server.html',
    preloadPath: '/tmp/preload.cjs',
    isPackaged: false,
    getParentWindow: () => null,
    clearDeploymentScopedState: vi.fn(async () => {}),
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
      isSimCloud: false,
    })
  })

  // Drives whether the offline page offers Sim's status page, which describes
  // only Sim's own deployments.
  it('marks a sim.ai origin as Sim cloud', () => {
    const cloud = makeDeps({
      config: makeConfig('https://www.sim.ai', (raw) => ({ ok: true, origin: raw })),
    })

    expect(createServerWindow(cloud).getConfiguration().isSimCloud).toBe(true)
  })

  it('relaunches after storing a different origin', async () => {
    const result = await createServerWindow(deps).setOrigin('https://sim.other.example')

    expect(result).toEqual({ ok: true, origin: 'https://sim.other.example', unchanged: false })
    expect(deps.config.flush).toHaveBeenCalled()
    expect(deps.relaunch).toHaveBeenCalledTimes(1)
  })

  // The saved route carries the previous deployment's workspace id, and
  // resolveStartRoute only discards a route on a confirmed 403 — a fresh
  // partition answers 401, so a kept route would survive onto the new server.
  it('drops the saved route when the origin changes', async () => {
    await createServerWindow(deps).setOrigin('https://sim.other.example')

    expect(deps.config.set).toHaveBeenCalledWith('lastRoute', undefined)
  })

  it('keeps the saved route when the origin is unchanged', async () => {
    await createServerWindow(deps).setOrigin(CURRENT)

    expect(deps.config.set).not.toHaveBeenCalled()
  })

  // Re-confirming the pre-filled URL is the common case here.
  it('does not relaunch when the origin is unchanged', async () => {
    const result = await createServerWindow(deps).setOrigin(CURRENT)

    expect(result).toEqual({ ok: true, origin: CURRENT, unchanged: true })
    expect(deps.relaunch).not.toHaveBeenCalled()
  })

  // Filesystem grants and the agent browser's jar are device-global with no
  // origin key, so without this the incoming deployment inherits directory
  // access and live third-party sessions the user granted the outgoing one.
  it('clears deployment-scoped capabilities before relaunching', async () => {
    await createServerWindow(deps).setOrigin('https://sim.other.example')

    expect(deps.clearDeploymentScopedState).toHaveBeenCalledTimes(1)
    expect(vi.mocked(deps.clearDeploymentScopedState).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.relaunch).mock.invocationCallOrder[0]
    )
  })

  it('does not clear them when the origin is unchanged', async () => {
    await createServerWindow(deps).setOrigin(CURRENT)

    expect(deps.clearDeploymentScopedState).not.toHaveBeenCalled()
  })

  // The origin is already persisted by this point, so a failed clear must not
  // strand the shell on the old server — but it is logged, not swallowed.
  it('still relaunches when the teardown fails', async () => {
    const failing = makeDeps({
      clearDeploymentScopedState: vi.fn(async () => {
        throw new Error('keychain unavailable')
      }),
    })

    const result = await createServerWindow(failing).setOrigin('https://sim.other.example')

    expect(result).toMatchObject({ ok: true, unchanged: false })
    expect(failing.relaunch).toHaveBeenCalledTimes(1)
  })

  it('surfaces a rejected origin without relaunching', async () => {
    const result = await createServerWindow(deps).setOrigin('ftp://sim.example.com')

    expect(result).toEqual({ ok: false, error: 'bad origin' })
    expect(deps.relaunch).not.toHaveBeenCalled()
    expect(deps.config.getOrigin()).toBe(CURRENT)
  })
})
