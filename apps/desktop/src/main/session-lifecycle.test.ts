import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import type { Session } from 'electron'
import {
  decideStartRoute,
  isLogoutNavigation,
  isSessionCookieName,
  probeSession,
  resolveStartRoute,
  tearDownSession,
} from '@/main/session-lifecycle'

const APP = 'https://sim.ai'

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
    expect(decideStartRoute(undefined)).toBe('/workspace')
    expect(decideStartRoute('//evil.example')).toBe('/workspace')
    expect(decideStartRoute('/login')).toBe('/workspace')
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

  it('falls back to the workspace picker after confirmed access denial', async () => {
    const session = sessionWithResponse(403, { error: 'Workspace access denied' })

    await expect(resolveStartRoute(session, APP, '/workspace/revoked/chat/c1')).resolves.toBe(
      '/workspace'
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
  it('waits for local secret revocation before clearing the web session', async () => {
    const order: string[] = []
    const session = {
      clearStorageData: vi.fn(async () => {
        order.push('session')
      }),
    } as unknown as Session

    await tearDownSession(
      session,
      async () => {
        await Promise.resolve()
        order.push('local')
      },
      { filePath: '/tmp/events.log', record: vi.fn() }
    )

    expect(order).toEqual(['local', 'session'])
  })
})
