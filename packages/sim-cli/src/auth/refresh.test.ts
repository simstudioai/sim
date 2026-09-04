import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readStoredCredential, writeCredentialsProfile } from '../config/profile'
import { refreshStoredOAuth } from './refresh'

const PROFILE = { name: 'default', endpoint: 'https://sim.test', authProfile: 'default' }
const OAUTH_CONTEXT = {
  issuer: 'https://sim.test/api/auth',
  loginId: 'login-1',
  scope: 'offline_access api:read',
}

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status }) as Response
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sim-cli-refresh-'))
  vi.stubEnv('SIM_CONFIG_DIR', dir)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

describe('refreshStoredOAuth', () => {
  it('rotates the pair on the server and persists what came back', async () => {
    writeCredentialsProfile('default', {
      kind: 'oauth',
      oauth: {
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        expiresAt: 1,
        ...OAUTH_CONTEXT,
      },
    })
    const fetchMock = vi.fn(async () =>
      reply(200, { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 })
    )
    vi.stubGlobal('fetch', fetchMock)

    const next = await refreshStoredOAuth(PROFILE, {
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: 1,
      ...OAUTH_CONTEXT,
    })

    expect(next.refreshToken).toBe('new-refresh')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'old-refresh',
    })
    expect(readStoredCredential('default')).toEqual({
      kind: 'oauth',
      oauth: {
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresAt: next.expiresAt,
        ...OAUTH_CONTEXT,
      },
    })
  })

  /**
   * The rotation race: a refresh token presented twice revokes the whole
   * session server-side. A process that took the lock second must find the
   * winner's tokens on disk and use them instead of presenting the dead one.
   */
  it('adopts a rotation another process already wrote instead of presenting the dead token', async () => {
    writeCredentialsProfile('default', {
      kind: 'oauth',
      oauth: {
        accessToken: 'winner-access',
        refreshToken: 'winner-refresh',
        expiresAt: 99,
        ...OAUTH_CONTEXT,
      },
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const next = await refreshStoredOAuth(PROFILE, {
      accessToken: 'stale-access',
      refreshToken: 'stale-refresh',
      expiresAt: 1,
      ...OAUTH_CONTEXT,
    })

    expect(next.refreshToken).toBe('winner-refresh')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('names the remedy when the server no longer honours the refresh token', async () => {
    writeCredentialsProfile('default', {
      kind: 'oauth',
      oauth: { accessToken: 'a', refreshToken: 'r', expiresAt: 1, ...OAUTH_CONTEXT },
    })
    vi.stubGlobal('fetch', async () => reply(400, { error: 'invalid_grant' }))

    await expect(
      refreshStoredOAuth(PROFILE, {
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: 1,
        ...OAUTH_CONTEXT,
      })
    ).rejects.toThrow('Run sim logout --profile default, then sim login --profile default.')
    expect(readStoredCredential('default')).toMatchObject({ kind: 'oauth' })
  })
})
