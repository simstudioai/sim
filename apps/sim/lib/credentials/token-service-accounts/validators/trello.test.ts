import { resetEnvMock, setEnv } from '@sim/testing'
import { jsonResponse } from '@sim/testing/helpers/http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  setEnv({ TRELLO_API_KEY: undefined })
})

afterAll(resetEnvMock)

import { validateTrelloServiceAccount } from '@/lib/credentials/token-service-accounts/validators/trello'

const FIELDS = { apiToken: 'ATTA0a1b2c3d' }

const mockFetch = vi.fn()

describe('validateTrelloServiceAccount', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    setEnv({ TRELLO_API_KEY: 'sim-api-key' })
  })

  it('sends the server API key and the user token as separate query params', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ id: 'abc123', fullName: 'Sim Bot', username: 'simbot' })
    )

    await validateTrelloServiceAccount(FIELDS)

    const [url] = mockFetch.mock.calls[0]
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe('https://api.trello.com/1/members/me')
    expect(parsed.searchParams.get('key')).toBe('sim-api-key')
    expect(parsed.searchParams.get('token')).toBe('ATTA0a1b2c3d')
    expect(parsed.searchParams.get('fields')).toBe('id,fullName,username')
  })

  it('throws invalid_credentials on 401 with an invalid token body', async () => {
    mockFetch.mockResolvedValue(jsonResponse('invalid token', 401))

    await expect(validateTrelloServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 401,
    })
  })

  it('throws provider_unavailable on 401 with an invalid key body', async () => {
    mockFetch.mockResolvedValue(jsonResponse('invalid key', 401))

    await expect(validateTrelloServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'provider_unavailable',
      status: 401,
      logDetail: { step: 'members_me', reason: 'Trello rejected the server API key' },
    })
  })

  it('throws provider_unavailable without fetching when the API key is not configured', async () => {
    setEnv({ TRELLO_API_KEY: undefined })

    await expect(validateTrelloServiceAccount(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'provider_unavailable',
      status: 500,
      logDetail: { reason: 'Trello API key is not configured' },
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
