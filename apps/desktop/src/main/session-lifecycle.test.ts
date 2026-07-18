import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import type { Session } from 'electron'
import {
  decideStartRoute,
  isLogoutNavigation,
  isSessionCookieName,
  probeSession,
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
  it('routes a signed-out launch to the login surface', () => {
    expect(decideStartRoute('invalid', '/workspace/ws1')).toBe('/login')
  })

  it('restores the last route when plausible', () => {
    expect(decideStartRoute('valid', '/workspace/ws1?tab=logs')).toBe('/workspace/ws1?tab=logs')
    expect(decideStartRoute('unknown', '/workspace/ws1')).toBe('/workspace/ws1')
  })

  it('falls back to /workspace for missing, unsafe, or auth-surface last routes', () => {
    expect(decideStartRoute('valid', undefined)).toBe('/workspace')
    expect(decideStartRoute('valid', '//evil.example')).toBe('/workspace')
    expect(decideStartRoute('valid', '/login')).toBe('/workspace')
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
