/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { TRELLO_API_KEY: undefined as string | undefined },
}))

vi.mock('@/lib/core/config/env', () => ({
  env: mockEnv,
}))

import { validateTrelloServiceAccount } from '@/lib/credentials/token-service-accounts/validators/trello'

const FIELDS = { apiToken: 'ATTA0a1b2c3d' }

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

const mockFetch = vi.fn()

describe('validateTrelloServiceAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockEnv.TRELLO_API_KEY = 'sim-api-key'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns displayName and metadata on success', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, { id: 'abc123', fullName: 'Sim Bot', username: 'simbot' })
    )

    const result = await validateTrelloServiceAccount(FIELDS)

    expect(result).toEqual({
      displayName: 'Sim Bot',
      auditMetadata: { trelloMemberId: 'abc123' },
      storedMetadata: { memberId: 'abc123', username: 'simbot' },
    })

    const [url] = mockFetch.mock.calls[0]
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe('https://api.trello.com/1/members/me')
    expect(parsed.searchParams.get('key')).toBe('sim-api-key')
    expect(parsed.searchParams.get('token')).toBe('ATTA0a1b2c3d')
    expect(parsed.searchParams.get('fields')).toBe('id,fullName,username')
  })

  it('throws invalid_credentials on 401 with an invalid token body', async () => {
    mockFetch.mockResolvedValue(jsonResponse(401, 'invalid token'))

    await expect(validateTrelloServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 401,
    })
  })

  it('throws provider_unavailable on 401 with an invalid key body', async () => {
    mockFetch.mockResolvedValue(jsonResponse(401, 'invalid key'))

    await expect(validateTrelloServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'provider_unavailable',
      status: 401,
      logDetail: { step: 'members_me', reason: 'Trello rejected the server API key' },
    })
  })

  it('throws invalid_credentials on 401 with any other body', async () => {
    mockFetch.mockResolvedValue(jsonResponse(401, 'unauthorized'))

    await expect(validateTrelloServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 401,
    })
  })

  it('throws provider_unavailable on a non-JSON 200 body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: '',
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON')
      },
      text: async () => '<html>proxy error</html>',
    } as unknown as Response)

    await expect(validateTrelloServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'provider_unavailable',
      status: 502,
    })
  })

  it('throws provider_unavailable on 500', async () => {
    mockFetch.mockResolvedValue(jsonResponse(500, { message: 'unavailable' }))

    await expect(validateTrelloServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'provider_unavailable',
      status: 500,
    })
  })

  it('throws provider_unavailable without fetching when the API key is not configured', async () => {
    mockEnv.TRELLO_API_KEY = undefined

    await expect(validateTrelloServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'provider_unavailable',
      status: 500,
      logDetail: { reason: 'Trello API key is not configured' },
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('throws provider_unavailable on missing id in success body', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { fullName: 'Sim Bot' }))

    await expect(validateTrelloServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'provider_unavailable',
      status: 502,
    })
  })
})
