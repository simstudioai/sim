import { mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { BrowserWindow, type Session } from 'electron'
import {
  completeAccountDataTeardown,
  initializeAccountDataRecovery,
} from '@/main/account-data-generation'
import {
  createSessionLifecycleCoordinator,
  decideStartRoute,
  probeSession,
  resolveStartRoute,
  tearDownSession,
} from '@/main/session-lifecycle'

const APP = 'https://sim.ai'
let recoveryDirectory: string

beforeEach(() => {
  recoveryDirectory = mkdtempSync(join(tmpdir(), 'sim-session-lifecycle-'))
  initializeAccountDataRecovery(join(recoveryDirectory, 'teardown-required.json'))
})

afterEach(async () => {
  completeAccountDataTeardown()
  initializeAccountDataRecovery(null)
  await rm(recoveryDirectory, { recursive: true, force: true })
})

function sessionWithResponse(status: number, body: unknown): Session {
  return {
    fetch: vi.fn(async () => new Response(JSON.stringify(body), { status })),
  } as unknown as Session
}

describe('decideStartRoute', () => {
  it('falls back to /workspace for missing, unsafe, or auth-surface last routes', () => {
    expect(decideStartRoute(undefined)).toBe('/home')
    expect(decideStartRoute('//evil.example')).toBe('/home')
    expect(decideStartRoute('/login')).toBe('/home')
  })
})

describe('resolveStartRoute', () => {
  it('falls back to the app entry after confirmed access denial', async () => {
    const session = sessionWithResponse(403, { error: 'Workspace access denied' })

    await expect(resolveStartRoute(session, APP, '/workspace/revoked/chat/c1')).resolves.toBe(
      '/home'
    )
  })

  it('preserves the saved route on auth, server, and network failures', async () => {
    await expect(
      resolveStartRoute(sessionWithResponse(401, {}), APP, '/workspace/ws1/home')
    ).resolves.toBe('/workspace/ws1/home')
    await expect(
      resolveStartRoute(sessionWithResponse(500, {}), APP, '/workspace/ws1/home')
    ).resolves.toBe('/workspace/ws1/home')

    const failing = {
      fetch: vi.fn(async () => {
        throw new Error('offline')
      }),
    } as unknown as Session
    await expect(resolveStartRoute(failing, APP, '/workspace/ws1/home')).resolves.toBe(
      '/workspace/ws1/home'
    )
  })
})

describe('probeSession', () => {
  it('reports unknown for server errors and network failures', async () => {
    await expect(probeSession(sessionWithResponse(500, {}), APP)).resolves.toBe('unknown')
    const failing = {
      fetch: vi.fn(async () => {
        throw new Error('offline')
      }),
    } as unknown as Session
    await expect(probeSession(failing, APP)).resolves.toBe('unknown')
  })
})

describe('tearDownSession', () => {
  it('revokes server-side first, then local secrets and the browser profile, then the web session', async () => {
    // Order is load-bearing: the server-side revoke needs the partition's
    // session cookie, which clearStorageData destroys.
    const order: string[] = []
    const session = {
      clearStorageData: vi.fn(async () => {
        order.push('session')
      }),
      clearCache: vi.fn(async () => {
        order.push('cache')
      }),
    } as unknown as Session

    await tearDownSession(
      session,
      APP,
      async () => {
        await Promise.resolve()
        order.push('local')
      },
      { filePath: '/tmp/events.log', record: vi.fn() },
      async () => {
        await Promise.resolve()
        order.push('browser')
      },
      async () => {
        await Promise.resolve()
        order.push('revoke')
      }
    )

    expect(order).toEqual(['revoke', 'local', 'browser', 'session', 'cache'])
  })

  it('does not erase local data when the recovery marker cannot be written', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sim-account-recovery-'))
    const blockedParent = join(directory, 'blocked')
    initializeAccountDataRecovery(join(blockedParent, 'teardown-required.json'))
    writeFileSync(blockedParent, 'not a directory')
    const clearHandoffState = vi.fn(async () => {})
    const clearBrowserProfile = vi.fn(async () => {})
    const clearStorageData = vi.fn(async () => {})
    const clearCache = vi.fn(async () => {})

    try {
      await expect(
        tearDownSession(
          { clearStorageData, clearCache } as unknown as Session,
          APP,
          clearHandoffState,
          { filePath: '/tmp/events.log', record: vi.fn() },
          clearBrowserProfile,
          async () => {}
        )
      ).rejects.toThrow('recovery marker')

      expect(clearHandoffState).not.toHaveBeenCalled()
      expect(clearBrowserProfile).not.toHaveBeenCalled()
      expect(clearStorageData).not.toHaveBeenCalled()
      expect(clearCache).not.toHaveBeenCalled()
    } finally {
      initializeAccountDataRecovery(null)
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('still clears local state when the server-side revoke fails', async () => {
    // Offline sign-out must not strand the user signed in locally.
    const clearStorageData = vi.fn(async () => {})
    const clearCache = vi.fn(async () => {})
    const session = { clearStorageData, clearCache } as unknown as Session

    await expect(
      tearDownSession(
        session,
        APP,
        async () => {},
        { filePath: '/tmp/events.log', record: vi.fn() },
        async () => {},
        async () => {
          throw new Error('offline')
        }
      )
    ).resolves.toBeUndefined()

    expect(clearStorageData).toHaveBeenCalled()
  })
})

describe('createSessionLifecycleCoordinator', () => {
  it('shares session observers and signs every app window out with one teardown', async () => {
    const cookiesOn = vi.fn()
    const webRequestOnCompleted = vi.fn()
    const clearStorageData = vi.fn(async () => {})
    const clearCache = vi.fn(async () => {})
    const session = {
      cookies: { on: cookiesOn },
      webRequest: { onCompleted: webRequestOnCompleted },
      clearStorageData,
      clearCache,
      fetch: vi.fn(async () => Response.json(null)),
    } as unknown as Session
    const first = new BrowserWindow()
    const second = new BrowserWindow()
    const clearHandoffState = vi.fn(async () => {})
    const coordinator = createSessionLifecycleCoordinator({
      appSession: session,
      origin: () => APP,
      events: { filePath: '/tmp/events.log', record: vi.fn() },
      clearHandoffState,
      clearBrowserProfile: vi.fn(async () => {}),
      getWindows: () => [first, second],
    })

    coordinator.attachWindow(first)
    coordinator.attachWindow(second)

    expect(cookiesOn).toHaveBeenCalledOnce()
    // The shell no longer watches API responses: session expiry is the web
    // app's to detect, so nothing here should subscribe to /api/* statuses.
    expect(webRequestOnCompleted).not.toHaveBeenCalled()

    const windowEventCalls = vi.mocked(first.webContents.on).mock.calls as unknown as Array<
      [string, (...args: unknown[]) => unknown]
    >
    const navigation = windowEventCalls.find(([event]) => event === 'did-navigate-in-page')?.[1] as
      | ((event: unknown, url: string) => void)
      | undefined
    navigation?.({}, `${APP}/login?fromLogout=true`)

    await vi.waitFor(() => {
      expect(clearStorageData).toHaveBeenCalledOnce()
      expect(first.loadURL).toHaveBeenCalledWith(`${APP}/login`)
      expect(second.loadURL).toHaveBeenCalledWith(`${APP}/login`)
    })
    expect(clearHandoffState).toHaveBeenCalledOnce()
  })

  it('shares one awaitable teardown and does not open login when clearing fails', async () => {
    let releaseBrowserClear: (() => void) | undefined
    const browserClear = new Promise<void>((resolve) => {
      releaseBrowserClear = resolve
    })
    const win = new BrowserWindow()
    const coordinator = createSessionLifecycleCoordinator({
      appSession: {
        cookies: { on: vi.fn() },
        clearStorageData: vi.fn(async () => {
          throw new Error('storage locked')
        }),
        clearCache: vi.fn(async () => {}),
      } as unknown as Session,
      origin: () => APP,
      events: { filePath: '/tmp/events.log', record: vi.fn() },
      clearHandoffState: vi.fn(async () => {}),
      clearBrowserProfile: vi.fn(() => browserClear),
      getWindows: () => [win],
    })

    const first = coordinator.signOut()
    const second = coordinator.signOut()
    expect(first).toBe(second)
    await expect(coordinator.awaitTeardown(1)).resolves.toBe(false)

    releaseBrowserClear?.()
    await expect(first).resolves.toBe(false)
    expect(win.loadURL).not.toHaveBeenCalled()
  })
})
