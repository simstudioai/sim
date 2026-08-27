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
    isPersistenceAvailable: () => true,
    getOrigin: () => stored,
    setOrigin: vi.fn((raw: string) => {
      const result = validate(raw)
      if (result.ok) stored = result.origin
      return result
    }),
    get: vi.fn(() => undefined),
    set: vi.fn(),
    flush: vi.fn(() => true),
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
    clearDeploymentScopedState: vi.fn(async (): Promise<readonly string[]> => []),
    canCompleteDeploymentScopedStateChange: vi.fn(() => true),
    completeDeploymentScopedStateChange: vi.fn(() => true),
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
    expect(
      vi.mocked(deps.completeDeploymentScopedStateChange).mock.invocationCallOrder[0]
    ).toBeGreaterThan(vi.mocked(deps.config.set).mock.invocationCallOrder[0])
    expect(
      vi.mocked(deps.completeDeploymentScopedStateChange).mock.invocationCallOrder[0]
    ).toBeGreaterThan(vi.mocked(deps.config.setOrigin).mock.invocationCallOrder[0])
    expect(
      vi.mocked(deps.completeDeploymentScopedStateChange).mock.invocationCallOrder[0]
    ).toBeLessThan(vi.mocked(deps.relaunch).mock.invocationCallOrder[0])
  })

  it('does not clear them when the origin is unchanged', async () => {
    await createServerWindow(deps).setOrigin(CURRENT)

    expect(deps.clearDeploymentScopedState).not.toHaveBeenCalled()
  })

  // The picker re-enables its button while a request is pending, and the IPC
  // boundary is reachable regardless of what the page does, so the transaction
  // has to be serialized here rather than in the renderer.
  it('refuses a second change while one is in flight', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const slow = makeDeps({
      clearDeploymentScopedState: vi.fn(async (): Promise<readonly string[]> => {
        await gate
        return []
      }),
    })
    const handle = createServerWindow(slow)

    const first = handle.setOrigin('https://sim.other.example')
    const second = await handle.setOrigin('https://sim.third.example')

    expect(second).toMatchObject({ ok: false })
    expect(second).toHaveProperty('error', expect.stringContaining('already in progress'))
    release?.()
    await expect(first).resolves.toMatchObject({ ok: true, unchanged: false })
    expect(slow.relaunch).toHaveBeenCalledTimes(1)
    expect(slow.config.setOrigin).toHaveBeenCalledTimes(1)
    expect(slow.config.setOrigin).toHaveBeenCalledWith('https://sim.other.example')
  })

  // The guard must not latch: a refused change has to leave the picker usable.
  it('allows a later change once the first has settled', async () => {
    const failing = makeDeps({
      clearDeploymentScopedState: vi.fn(async () => ['local file access']),
    })
    const handle = createServerWindow(failing)

    await handle.setOrigin('https://sim.other.example')
    const second = await handle.setOrigin('https://sim.third.example')

    expect(second).toMatchObject({ ok: false })
    expect(second).toHaveProperty('error', expect.stringContaining('local file access'))
  })

  // Fail closed. A store that could not be emptied is access the incoming
  // deployment would inherit and that startup would restore, so the change is
  // refused outright — and because nothing is persisted until the teardown
  // succeeds, refusing leaves the shell exactly where it was.
  it('refuses the change when a store could not be cleared', async () => {
    const failing = makeDeps({
      clearDeploymentScopedState: vi.fn(async () => ['local file access']),
    })

    const result = await createServerWindow(failing).setOrigin('https://sim.other.example')

    expect(result).toMatchObject({ ok: false })
    expect(result).toHaveProperty('error', expect.stringContaining('local file access'))
    // The stores clear independently, so the other one may already be empty and
    // cannot be restored. Naming only the failure would read as "nothing
    // happened", which is not what happened.
    expect(result).toHaveProperty('error', expect.stringContaining('may already have been cleared'))
    expect(failing.relaunch).not.toHaveBeenCalled()
    expect(failing.completeDeploymentScopedStateChange).not.toHaveBeenCalled()
    expect(failing.config.setOrigin).not.toHaveBeenCalled()
    expect(failing.config.getOrigin()).toBe(CURRENT)
  })

  it('refuses the change when the teardown throws outright', async () => {
    const throwing = makeDeps({
      clearDeploymentScopedState: vi.fn(async () => {
        throw new Error('keychain unavailable')
      }),
    })

    const result = await createServerWindow(throwing).setOrigin('https://sim.other.example')

    expect(result).toMatchObject({ ok: false })
    expect(throwing.relaunch).not.toHaveBeenCalled()
    expect(throwing.completeDeploymentScopedStateChange).not.toHaveBeenCalled()
    expect(throwing.config.getOrigin()).toBe(CURRENT)
  })

  it('keeps teardown recovery pending when persisting the new origin fails', async () => {
    const config = makeConfig(CURRENT, () => ({ ok: false, error: 'disk is read-only' }))
    const failing = makeDeps({ config })

    const result = await createServerWindow(failing).setOrigin('https://sim.other.example')

    expect(result).toEqual({ ok: false, error: 'disk is read-only' })
    expect(failing.completeDeploymentScopedStateChange).not.toHaveBeenCalled()
    expect(failing.relaunch).not.toHaveBeenCalled()
  })

  it('relaunches against the committed server when completing teardown fails', async () => {
    const failing = makeDeps({
      completeDeploymentScopedStateChange: vi.fn(() => {
        throw new Error('marker is read-only')
      }),
    })

    const result = await createServerWindow(failing).setOrigin('https://sim.other.example')

    expect(result).toEqual({
      ok: true,
      origin: 'https://sim.other.example',
      unchanged: false,
    })
    expect(failing.config.setOrigin).toHaveBeenCalledWith('https://sim.other.example')
    expect(failing.config.getOrigin()).toBe('https://sim.other.example')
    expect(failing.relaunch).toHaveBeenCalledOnce()
  })

  it('relaunches when teardown completion remains pending after the commit', async () => {
    const pending = makeDeps({
      completeDeploymentScopedStateChange: vi.fn(() => false),
    })

    const result = await createServerWindow(pending).setOrigin('https://sim.other.example')

    expect(result).toMatchObject({ ok: true, unchanged: false })
    expect(pending.config.getOrigin()).toBe('https://sim.other.example')
    expect(pending.relaunch).toHaveBeenCalledOnce()
  })

  it('refuses the change while a stronger account teardown is active', async () => {
    const failing = makeDeps({
      canCompleteDeploymentScopedStateChange: vi.fn(() => false),
    })

    const result = await createServerWindow(failing).setOrigin('https://sim.other.example')

    expect(result).toMatchObject({ ok: false })
    expect(failing.config.set).not.toHaveBeenCalled()
    expect(failing.config.setOrigin).not.toHaveBeenCalled()
    expect(failing.completeDeploymentScopedStateChange).not.toHaveBeenCalled()
    expect(failing.relaunch).not.toHaveBeenCalled()
  })

  // Validated up front with the shell's own rule, before anything is torn down
  // or written, so a typo costs nothing.
  it('surfaces a rejected origin without tearing anything down', async () => {
    const result = await createServerWindow(deps).setOrigin('ftp://sim.example.com')

    expect(result).toMatchObject({ ok: false })
    expect(result).toHaveProperty('error', expect.stringContaining('HTTPS'))
    expect(deps.clearDeploymentScopedState).not.toHaveBeenCalled()
    expect(deps.relaunch).not.toHaveBeenCalled()
    expect(deps.config.getOrigin()).toBe(CURRENT)
  })
})
