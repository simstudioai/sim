import { get as httpGet } from 'node:http'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import {
  buildRedeemScript,
  type ConnectHandoffCallback,
  createHandoffManager,
  type HandoffCallback,
  type HandoffCallbacks,
  type HandoffManagerDeps,
} from '@/main/handoff'
import type { EventRecorder } from '@/main/observability'

const VALID_STATE = 'a'.repeat(32)
const VALID_TOKEN = 'tok_1234567890abcdef'

function makeEvents(): EventRecorder {
  return { filePath: '/tmp/none', record: vi.fn() }
}

function makeDeps(overrides: Partial<HandoffManagerDeps> = {}): HandoffManagerDeps {
  return {
    origin: () => 'https://sim.ai',
    openExternal: vi.fn(async () => true),
    events: makeEvents(),
    currentUserId: vi.fn(async () => 'user-1'),
    ...overrides,
  }
}

function makeCallbacks(overrides: Partial<HandoffCallbacks> = {}): HandoffCallbacks {
  return { onLogin: () => {}, onConnect: () => {}, ...overrides }
}

describe('buildRedeemScript', () => {
  it('embeds the token JSON-escaped, targets the verify endpoint, and returns the status', () => {
    const script = buildRedeemScript('abc"def')
    expect(script).toContain('/api/auth/one-time-token/verify')
    expect(script).toContain("credentials: 'include'")
    expect(script).toContain(JSON.stringify(JSON.stringify({ token: 'abc"def' })))
    expect(script).toContain('return response.status')
  })
})

describe('createHandoffManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('begin opens the landing page with state and the loopback port', async () => {
    const deps = makeDeps()
    const manager = createHandoffManager(deps, makeCallbacks())
    const opened = await manager.begin()
    expect(opened).toBe(true)

    const openExternal = vi.mocked(deps.openExternal)
    expect(openExternal).toHaveBeenCalledTimes(1)
    const landing = new URL(openExternal.mock.calls[0][0])
    expect(landing.origin).toBe('https://sim.ai')
    expect(landing.pathname).toBe('/desktop/auth')
    expect(landing.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(Number(landing.searchParams.get('port'))).toBeGreaterThan(0)
    manager.clear()
  })

  it('consume is single-use, state-bound, and TTL-bound', async () => {
    let nowValue = 1_000_000
    const deps = makeDeps({ now: () => nowValue })
    const manager = createHandoffManager(deps, makeCallbacks())
    await manager.begin()
    const state = new URL(vi.mocked(deps.openExternal).mock.calls[0][0]).searchParams.get(
      'state'
    ) as string

    expect(manager.consume('z'.repeat(32), 'login')).toBe(false)
    expect(manager.consume(state, 'login')).toBe(true)
    expect(manager.consume(state, 'login')).toBe(false)

    await manager.begin()
    const secondState = new URL(vi.mocked(deps.openExternal).mock.calls[1][0]).searchParams.get(
      'state'
    ) as string
    nowValue += 31 * 60 * 1000
    expect(manager.consume(secondState, 'login')).toBe(false)
    manager.clear()
  })

  it('loopback accepts one valid callback, rejects bad input, then closes', async () => {
    const received: HandoffCallback[] = []
    const deps = makeDeps()
    const manager = createHandoffManager(
      deps,
      makeCallbacks({ onLogin: (callback) => received.push(callback) })
    )
    await manager.begin()
    const landing = new URL(vi.mocked(deps.openExternal).mock.calls[0][0])
    const port = landing.searchParams.get('port') as string
    const state = landing.searchParams.get('state') as string
    const base = `http://127.0.0.1:${port}`

    expect((await fetch(`${base}/other`)).status).toBe(404)

    const badToken = await fetch(`${base}/auth/callback?token=bad token&state=${state}`)
    expect(badToken.status).toBe(400)
    expect(received).toHaveLength(0)

    const ok = await fetch(`${base}/auth/callback?token=${VALID_TOKEN}&state=${state}`, {
      redirect: 'manual',
    })
    // Hands the browser back to a real app page rather than serving HTML from
    // the main process, so the closing screen matches the rest of Sim.
    expect(ok.status).toBe(302)
    expect(ok.headers.get('location')).toBe('https://sim.ai/desktop/done?kind=auth')
    expect(received).toEqual([{ token: VALID_TOKEN, state }])

    await expect(
      fetch(`${base}/auth/callback?token=${VALID_TOKEN}&state=${state}`, { redirect: 'manual' })
    ).rejects.toThrow()
  })

  it('rejects a wrong-state callback without killing the sign-in', async () => {
    const received: HandoffCallback[] = []
    const deps = makeDeps()
    const manager = createHandoffManager(
      deps,
      makeCallbacks({ onLogin: (callback) => received.push(callback) })
    )
    await manager.begin()
    const landing = new URL(vi.mocked(deps.openExternal).mock.calls[0][0])
    const base = `http://127.0.0.1:${landing.searchParams.get('port')}`
    const state = landing.searchParams.get('state') as string

    // This port is reachable by any local process, and by any page the user
    // has open via a no-CORS GET. Tearing the one-shot server down before
    // checking the state let any of them cancel the sign-in.
    const wrongState = await fetch(
      `${base}/auth/callback?token=${VALID_TOKEN}&state=${'z'.repeat(32)}`
    )
    expect(wrongState.status).toBe(403)
    expect(received).toHaveLength(0)

    const ok = await fetch(`${base}/auth/callback?token=${VALID_TOKEN}&state=${state}`, {
      redirect: 'manual',
    })
    expect(ok.status).toBe(302)
    expect(received).toEqual([{ token: VALID_TOKEN, state }])
  })

  it('refuses a request that does not address the loopback by name', async () => {
    const received: HandoffCallback[] = []
    const deps = makeDeps()
    const manager = createHandoffManager(
      deps,
      makeCallbacks({ onLogin: (callback) => received.push(callback) })
    )
    await manager.begin()
    const landing = new URL(vi.mocked(deps.openExternal).mock.calls[0][0])
    const state = landing.searchParams.get('state') as string

    // The DNS-rebinding shape: an attacker hostname resolving to 127.0.0.1.
    const status = await new Promise<number>((resolvePromise, rejectPromise) => {
      const request = httpGet(
        {
          host: '127.0.0.1',
          port: Number(landing.searchParams.get('port')),
          path: `/auth/callback?token=${VALID_TOKEN}&state=${state}`,
          headers: { Host: 'attacker.example' },
        },
        (response) => {
          response.resume()
          resolvePromise(response.statusCode ?? 0)
        }
      )
      request.on('error', rejectPromise)
    })

    expect(status).toBe(403)
    expect(received).toHaveLength(0)
    manager.clear()
  })

  it('cleans up the pending handoff when the browser cannot be opened', async () => {
    const deps = makeDeps({ openExternal: vi.fn(async () => false) })
    const manager = createHandoffManager(deps, makeCallbacks())
    await manager.begin()
    const state = new URL(vi.mocked(deps.openExternal).mock.calls[0][0]).searchParams.get(
      'state'
    ) as string
    expect(manager.consume(state, 'login')).toBe(false)
  })
  it('beginConnect opens /desktop/connect with provider, state, and port', async () => {
    const deps = makeDeps()
    const manager = createHandoffManager(deps, makeCallbacks())
    expect(await manager.beginConnect('not a provider!')).toBe(false)
    expect(await manager.beginConnect('google-email')).toBe(true)

    const landing = new URL(vi.mocked(deps.openExternal).mock.calls[0][0])
    expect(landing.pathname).toBe('/desktop/connect')
    expect(landing.searchParams.get('provider')).toBe('google-email')
    expect(landing.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(Number(landing.searchParams.get('port'))).toBeGreaterThan(0)
    manager.clear()
  })

  it('connect loopback forwards state and optional error, rejecting bad slugs', async () => {
    const received: ConnectHandoffCallback[] = []
    const deps = makeDeps()
    const manager = createHandoffManager(
      deps,
      makeCallbacks({ onConnect: (callback) => received.push(callback) })
    )
    await manager.beginConnect('google-email')
    const landing = new URL(vi.mocked(deps.openExternal).mock.calls[0][0])
    const base = `http://127.0.0.1:${landing.searchParams.get('port')}`
    const state = landing.searchParams.get('state') as string

    const badError = await fetch(`${base}/connect/callback?state=${state}&error=${'x'.repeat(80)}`)
    expect(badError.status).toBe(400)
    expect(received).toHaveLength(0)

    const ok = await fetch(`${base}/connect/callback?state=${state}&error=oauth_failed`, {
      redirect: 'manual',
    })
    expect(ok.status).toBe(302)
    expect(ok.headers.get('location')).toBe('https://sim.ai/desktop/done?kind=connect')
    expect(received).toEqual([{ state, error: 'oauth_failed' }])
    expect(manager.consume(state, 'connect')).toBe(true)
  })

  it('consume enforces the handoff kind', async () => {
    const deps = makeDeps()
    const manager = createHandoffManager(deps, makeCallbacks())
    await manager.beginConnect('google-email')
    const state = new URL(vi.mocked(deps.openExternal).mock.calls[0][0]).searchParams.get(
      'state'
    ) as string
    expect(manager.consume(state, 'login')).toBe(false)
    expect(manager.consume(state, 'connect')).toBe(true)
  })
})

describe('connect handoff account pinning', () => {
  it('pins the connect flow to the account the app is signed in as', async () => {
    // The OAuth flow runs in the browser under the BROWSER's session, which is
    // a different row from the app's — without this the credential would attach
    // to whichever account the browser happens to be signed into.
    const deps = makeDeps({ currentUserId: vi.fn(async () => 'desktop-user') })
    const manager = createHandoffManager(deps, makeCallbacks())

    expect(await manager.beginConnect('google-email')).toBe(true)

    const landing = new URL(vi.mocked(deps.openExternal).mock.calls[0][0])
    expect(landing.pathname).toBe('/desktop/connect')
    expect(landing.searchParams.get('user')).toBe('desktop-user')
    manager.clear()
  })

  it('omits the pin when the app account cannot be read', async () => {
    // Offline or signed out: fall back to the page's own login redirect rather
    // than blocking a connect on a failed probe.
    const deps = makeDeps({ currentUserId: vi.fn(async () => null) })
    const manager = createHandoffManager(deps, makeCallbacks())

    expect(await manager.beginConnect('google-email')).toBe(true)

    const landing = new URL(vi.mocked(deps.openExternal).mock.calls[0][0])
    expect(landing.searchParams.has('user')).toBe(false)
    manager.clear()
  })
})
