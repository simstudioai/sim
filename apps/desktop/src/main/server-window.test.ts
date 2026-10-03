import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import type { ConfigStore, OriginValidation } from '@/main/config'
import { createServerWindow, type ServerWindowDeps } from '@/main/server-window'
import { dialog, BrowserWindow as MockBrowserWindow, session } from '@/test/electron-mock'

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
    preloadPath: '/tmp/preload.cjs',
    isPackaged: false,
    getParentWindow: () => null,
    prepareDeploymentScopedStateChange: vi.fn(() => true),
    clearDeploymentScopedState: vi.fn(async (): Promise<readonly string[]> => []),
    completeDeploymentScopedStateChange: vi.fn((commit) => commit()),
    relaunch: vi.fn(),
    ...overrides,
  }
}

type WebContentsHandler = (...args: unknown[]) => void

function openPicker(deps: ServerWindowDeps) {
  const ses = {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    protocol: { isProtocolHandled: vi.fn(() => false), handle: vi.fn() },
  }
  vi.mocked(session.fromPartition).mockReturnValue(ses as never)
  createServerWindow(deps).open()
  const win = MockBrowserWindow.instances.at(-1)
  if (!win) throw new Error('no window was created')
  const handler = (name: string): WebContentsHandler => {
    const found = win.webContents.on.mock.calls.find(([event]) => event === name)?.[1]
    if (!found) throw new Error(`no ${name} handler`)
    return found as WebContentsHandler
  }
  return { win, ses, handler }
}

describe('server window', () => {
  let deps: ServerWindowDeps

  beforeEach(() => {
    vi.useFakeTimers()
    deps = makeDeps()
    MockBrowserWindow.instances = []
    vi.mocked(dialog.showMessageBox).mockClear()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('never leaves a blank sheet when the page fails to load', () => {
    const { win, handler } = openPicker(deps)

    handler('did-fail-load')({}, -6, 'ERR_FILE_NOT_FOUND', 'sim-shell://pages/server.html', false)
    expect(win.destroy).not.toHaveBeenCalled()
    handler('did-fail-load')({}, -3, 'ERR_ABORTED', 'sim-shell://pages/server.html', true)
    expect(win.destroy).not.toHaveBeenCalled()

    handler('did-fail-load')({}, -6, 'ERR_FILE_NOT_FOUND', 'sim-shell://pages/server.html', true)
    expect(win.destroy).toHaveBeenCalledTimes(1)
    expect(dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
  })

  // Filesystem grants and the agent browser's jar are device-global with no
  // origin key, so without this the incoming deployment inherits directory
  // access and live third-party sessions the user granted the outgoing one.
  it('clears deployment-scoped capabilities before relaunching', async () => {
    await createServerWindow(deps).setOrigin('https://sim.other.example')

    expect(deps.prepareDeploymentScopedStateChange).toHaveBeenCalledTimes(1)
    expect(deps.clearDeploymentScopedState).toHaveBeenCalledTimes(1)
    expect(
      vi.mocked(deps.prepareDeploymentScopedStateChange).mock.invocationCallOrder[0]
    ).toBeLessThan(vi.mocked(deps.clearDeploymentScopedState).mock.invocationCallOrder[0])
    expect(vi.mocked(deps.clearDeploymentScopedState).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.relaunch).mock.invocationCallOrder[0]
    )
    expect(vi.mocked(deps.clearDeploymentScopedState).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.completeDeploymentScopedStateChange).mock.invocationCallOrder[0]
    )
    expect(
      vi.mocked(deps.completeDeploymentScopedStateChange).mock.invocationCallOrder[0]
    ).toBeLessThan(vi.mocked(deps.config.set).mock.invocationCallOrder[0])
    expect(
      vi.mocked(deps.completeDeploymentScopedStateChange).mock.invocationCallOrder[0]
    ).toBeLessThan(vi.mocked(deps.config.setOrigin).mock.invocationCallOrder[0])
    expect(
      vi.mocked(deps.completeDeploymentScopedStateChange).mock.invocationCallOrder[0]
    ).toBeLessThan(vi.mocked(deps.relaunch).mock.invocationCallOrder[0])
  })

  it('does not erase or persist anything when recovery intent cannot be recorded', async () => {
    const blocked = makeDeps({ prepareDeploymentScopedStateChange: vi.fn(() => false) })
    const handle = createServerWindow(blocked)

    await expect(handle.setOrigin('https://sim.other.example')).resolves.toMatchObject({
      ok: false,
    })
    expect(blocked.clearDeploymentScopedState).not.toHaveBeenCalled()
    expect(blocked.completeDeploymentScopedStateChange).not.toHaveBeenCalled()
    expect(blocked.config.set).not.toHaveBeenCalled()
    expect(blocked.config.setOrigin).not.toHaveBeenCalled()
    expect(blocked.relaunch).not.toHaveBeenCalled()

    vi.mocked(blocked.prepareDeploymentScopedStateChange).mockReturnValue(true)
    await expect(handle.setOrigin('https://sim.other.example')).resolves.toMatchObject({ ok: true })
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

  it('relaunches against the committed server when completing teardown fails', async () => {
    const failing = makeDeps({
      completeDeploymentScopedStateChange: vi.fn((commit) => {
        commit()
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

  it('refuses the change while a stronger account teardown is active', async () => {
    const failing = makeDeps({
      completeDeploymentScopedStateChange: vi.fn(() => false),
    })

    const result = await createServerWindow(failing).setOrigin('https://sim.other.example')

    expect(result).toMatchObject({ ok: false })
    expect(failing.config.set).not.toHaveBeenCalled()
    expect(failing.config.setOrigin).not.toHaveBeenCalled()
    expect(failing.completeDeploymentScopedStateChange).toHaveBeenCalledOnce()
    expect(failing.relaunch).not.toHaveBeenCalled()
  })
})
