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
  isLogoutNavigation,
  isSessionCookieName,
  probeSession,
  resolveStartRoute,
  revokeAppSession,
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

describe('isSessionCookieName', () => {
  it('matches the better-auth session cookie on secure and non-secure hosts', () => {
    expect(isSessionCookieName('better-auth.session_token')).toBe(true)
    expect(isSessionCookieName('__Secure-better-auth.session_token')).toBe(true)
  })

  it('ignores non-session cookies', () => {
    expect(isSessionCookieName('better-auth.session_data')).toBe(false)
    expect(isSessionCookieName('__Host-csrf')).toBe(false)
    expect(isSessionCookieName('theme')).toBe(false)
  })
})

function sessionWithResponse(status: number, body: unknown): Session {
  return {
    fetch: vi.fn(async () => new Response(JSON.stringify(body), { status })),
  } as unknown as Session
}

describe('isLogoutNavigation', () => {
  it('detects the web sign-out navigation', () => {
    expect(isLogoutNavigation(`${APP}/login?fromLogout=true`, APP)).toBe(true)
  })

  it('ignores plain login loads, other origins, and garbage', () => {
    expect(isLogoutNavigation(`${APP}/login`, APP)).toBe(false)
    expect(isLogoutNavigation(`${APP}/login?fromLogout=false`, APP)).toBe(false)
    expect(isLogoutNavigation('https://evil.example/login?fromLogout=true', APP)).toBe(false)
    expect(isLogoutNavigation('not a url', APP)).toBe(false)
  })
})

describe('decideStartRoute', () => {
  it('restores the last route when plausible', () => {
    expect(decideStartRoute('/workspace/ws1?tab=logs')).toBe('/workspace/ws1?tab=logs')
    expect(decideStartRoute('/workspace/ws1')).toBe('/workspace/ws1')
  })

  it('falls back to /workspace for missing, unsafe, or auth-surface last routes', () => {
    expect(decideStartRoute(undefined)).toBe('/home')
    expect(decideStartRoute('//evil.example')).toBe('/home')
    expect(decideStartRoute('/login')).toBe('/home')
  })
})

describe('resolveStartRoute', () => {
  it('restores an accessible saved workspace route', async () => {
    const session = sessionWithResponse(200, { workspace: { id: 'ws1' } })

    await expect(resolveStartRoute(session, APP, '/workspace/ws1/home')).resolves.toBe(
      '/workspace/ws1/home'
    )
    expect(vi.mocked(session.fetch)).toHaveBeenCalledWith(
      `${APP}/api/workspaces/ws1/host-context`,
      expect.objectContaining({ cache: 'no-store' })
    )
  })

  it('falls back to the app entry after confirmed access denial', async () => {
    const session = sessionWithResponse(403, { error: 'Workspace access denied' })

    await expect(resolveStartRoute(session, APP, '/workspace/revoked/chat/c1')).resolves.toBe(
      '/home'
    )
  })

  it('does not probe routes without a workspace id', async () => {
    const session = sessionWithResponse(200, {})

    await expect(resolveStartRoute(session, APP, '/workspace')).resolves.toBe('/workspace')
    expect(session.fetch).not.toHaveBeenCalled()
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
  it('reports valid when a session or user is present', async () => {
    await expect(probeSession(sessionWithResponse(200, { user: { id: 'u1' } }), APP)).resolves.toBe(
      'valid'
    )
    await expect(
      probeSession(sessionWithResponse(200, { session: { id: 's1' } }), APP)
    ).resolves.toBe('valid')
  })

  it('reports invalid for a null session body', async () => {
    await expect(probeSession(sessionWithResponse(200, null), APP)).resolves.toBe('invalid')
  })

  it('reports unknown for server errors and network failures', async () => {
    await expect(probeSession(sessionWithResponse(500, {}), APP)).resolves.toBe('unknown')
    const failing = {
      fetch: vi.fn(async () => {
        throw new Error('offline')
      }),
    } as unknown as Session
    await expect(probeSession(failing, APP)).resolves.toBe('unknown')
  })

  it('asks the get-session endpoint with the partition cookies', async () => {
    const ses = sessionWithResponse(200, null)
    await probeSession(ses, APP)
    expect(vi.mocked(ses.fetch).mock.calls[0][0]).toBe(`${APP}/api/auth/get-session`)
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

  it('attempts every local erasure but rejects when the browser profile survives', async () => {
    const clearStorageData = vi.fn(async () => {})
    const clearCache = vi.fn(async () => {})
    const session = { clearStorageData, clearCache } as unknown as Session

    await expect(
      tearDownSession(
        session,
        APP,
        async () => {},
        { filePath: '/tmp/events.log', record: vi.fn() },
        async () => {
          throw new Error('browser view already destroyed')
        },
        async () => {}
      )
    ).rejects.toThrow('account-data stores could not be cleared')

    expect(clearStorageData).toHaveBeenCalled()
    expect(clearCache).toHaveBeenCalled()
  })

  it('attempts every local erasure but rejects when account state survives', async () => {
    const clearStorageData = vi.fn(async () => {})
    const clearCache = vi.fn(async () => {})
    const clearBrowserProfile = vi.fn(async () => {})
    const session = { clearStorageData, clearCache } as unknown as Session

    await expect(
      tearDownSession(
        session,
        APP,
        async () => {
          throw new Error('local store unavailable')
        },
        { filePath: '/tmp/events.log', record: vi.fn() },
        clearBrowserProfile,
        async () => {}
      )
    ).rejects.toThrow('account-data stores could not be cleared')

    expect(clearBrowserProfile).toHaveBeenCalledOnce()
    expect(clearStorageData).toHaveBeenCalledOnce()
    expect(clearCache).toHaveBeenCalledOnce()
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

  it('rejects when the app cache cannot be cleared', async () => {
    const session = {
      clearStorageData: vi.fn(async () => {}),
      clearCache: vi.fn(async () => {
        throw new Error('cache busy')
      }),
    } as unknown as Session

    await expect(
      tearDownSession(
        session,
        APP,
        async () => {},
        { filePath: '/tmp/events.log', record: vi.fn() },
        async () => {},
        async () => {}
      )
    ).rejects.toThrow('account-data stores could not be cleared')
  })
})

describe('revokeAppSession', () => {
  const origin = 'https://sim.ai'

  function windowAt(url: string, destroyed = false) {
    const executeJavaScript = vi.fn(async (_script: string) => 200)
    return {
      win: {
        isDestroyed: () => destroyed,
        webContents: { getURL: () => url, executeJavaScript },
      } as unknown as BrowserWindow,
      executeJavaScript,
    }
  }

  it('POSTs sign-out from the app-origin renderer so the session row is deleted', async () => {
    const { win, executeJavaScript } = windowAt(`${origin}/workspace`)

    await revokeAppSession(win, origin)

    expect(executeJavaScript).toHaveBeenCalledTimes(1)
    const script = executeJavaScript.mock.calls[0][0]
    expect(script).toContain('/api/auth/sign-out')
    expect(script).toContain("credentials: 'include'")
  })

  it('skips a window that is off-origin or destroyed', async () => {
    // The offline page and a lookalike host must never be asked to sign out —
    // the request would not be same-origin and could not carry the cookie.
    for (const url of ['about:blank', 'https://sim.ai.evil.example/workspace']) {
      const { win, executeJavaScript } = windowAt(url)
      await revokeAppSession(win, origin)
      expect(executeJavaScript).not.toHaveBeenCalled()
    }

    const destroyed = windowAt(`${origin}/workspace`, true)
    await revokeAppSession(destroyed.win, origin)
    expect(destroyed.executeJavaScript).not.toHaveBeenCalled()
  })

  it('does not throw when the renderer rejects', async () => {
    const win = {
      isDestroyed: () => false,
      webContents: {
        getURL: () => `${origin}/workspace`,
        executeJavaScript: vi.fn(async () => {
          throw new Error('render frame disposed')
        }),
      },
    } as unknown as BrowserWindow

    await expect(revokeAppSession(win, origin)).resolves.toBeUndefined()
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
