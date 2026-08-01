/**
 * @vitest-environment node
 *
 * Regression test: the credentials response must expose only display metadata,
 * never the connected account's OAuth access/refresh token.
 */

import { account, user } from '@sim/db/schema'
import {
  dbChainMockFns,
  environmentUtilsMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvironmentUtilsMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const SECRET_ACCESS_TOKEN = 'ya29.a0SECRET_GOOGLE_BEARER_TOKEN_DO_NOT_LEAK'

const { getAllOAuthServicesMock, decodeJwtMock } = vi.hoisted(() => ({
  getAllOAuthServicesMock: vi.fn(),
  decodeJwtMock: vi.fn(),
}))

const getPersonalAndWorkspaceEnvMock = environmentUtilsMockFns.mockGetPersonalAndWorkspaceEnv

afterAll(resetEnvironmentUtilsMock)

vi.mock('@/lib/oauth', () => ({
  getAllOAuthServices: getAllOAuthServicesMock,
}))

vi.mock('jose', () => ({
  decodeJwt: decodeJwtMock,
}))

import { getCredentialsServerTool } from './get-credentials'

/**
 * Wires the two sequential `db.select()` reads the tool performs:
 * 1. `select().from(account).where()` → account rows (awaited directly)
 * 2. `select({...}).from(user).where().limit(1)` → user row
 */
function wireDb(accountRows: unknown[], userRows: Array<{ email: string }>) {
  queueTableRows(account, accountRows)
  queueTableRows(user, userRows)
}

describe('getCredentialsServerTool', () => {
  afterAll(() => {
    resetDbChainMock()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()

    wireDb(
      [
        {
          id: 'acct-google-1',
          providerId: 'google-default',
          accountId: '1234567890',
          idToken: 'jwt-token',
          accessToken: SECRET_ACCESS_TOKEN,
          refreshToken: 'refresh-secret',
          updatedAt: new Date('2026-04-17T02:26:05.546Z'),
        },
      ],
      [{ email: 'brent@cellular.so' }]
    )

    getAllOAuthServicesMock.mockReturnValue([
      {
        providerId: 'google-default',
        name: 'Google',
        description: 'Google account',
        baseProvider: 'google',
      },
      {
        providerId: 'slack',
        name: 'Slack',
        description: 'Slack workspace',
        baseProvider: 'slack',
      },
    ])

    getPersonalAndWorkspaceEnvMock.mockResolvedValue({
      personalEncrypted: {},
      workspaceEncrypted: {},
      conflicts: [],
    })

    decodeJwtMock.mockReturnValue({ email: 'brent@cellular.so' })
  })

  it('never returns access tokens for connected OAuth credentials', async () => {
    const result = await getCredentialsServerTool.execute({}, { userId: 'user-1' })

    const credentials = result.oauth.connected.credentials
    expect(credentials).toHaveLength(1)

    for (const credential of credentials) {
      expect(credential).not.toHaveProperty('accessToken')
      expect(credential).not.toHaveProperty('refreshToken')
      expect(credential).not.toHaveProperty('idToken')
    }
  })

  it('returns only masked display metadata for each credential', async () => {
    const result = await getCredentialsServerTool.execute({}, { userId: 'user-1' })

    expect(result.oauth.connected.credentials[0]).toEqual({
      id: 'acct-google-1',
      name: 'brent@cellular.so',
      provider: 'google-default',
      serviceName: 'Google',
      lastUsed: '2026-04-17T02:26:05.546Z',
      isDefault: true,
    })
  })

  it('does not leak the token value anywhere in the serialized response', async () => {
    const result = await getCredentialsServerTool.execute({}, { userId: 'user-1' })

    expect(JSON.stringify(result)).not.toContain(SECRET_ACCESS_TOKEN)
    expect(JSON.stringify(result)).not.toContain('refresh-secret')
  })

  it('rejects unauthenticated callers without touching the database', async () => {
    await expect(getCredentialsServerTool.execute({}, undefined)).rejects.toThrow(
      'Authentication required'
    )
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})
