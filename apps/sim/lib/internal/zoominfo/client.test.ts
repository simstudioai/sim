import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { requestZoomInfo } from '@/lib/internal/zoominfo/client'

const { mockSecureFetchWithValidation } = inputValidationMockFns
const REQUEST = { path: '/data/v1/companies/search', method: 'POST' as const, body: {} }

describe('ZoomInfo requests', () => {
  beforeEach(() => {
    mockSecureFetchWithValidation.mockReset()
  })

  it("sends a saved credential's token to the API without a token exchange", async () => {
    mockSecureFetchWithValidation.mockResolvedValue(Response.json({ data: [] }))

    await expect(
      requestZoomInfo({ ...REQUEST, accessToken: 'minted-token' }, 'request-1')
    ).resolves.toEqual({ status: 200, data: { data: [] } })

    expect(mockSecureFetchWithValidation).toHaveBeenCalledTimes(1)
    const [url, options] = mockSecureFetchWithValidation.mock.calls[0]
    expect(url).toBe('https://api.zoominfo.com/gtm/data/v1/companies/search')
    expect(options).toMatchObject({ maxRedirects: 0 })
    expect(options.headers.Authorization).toBe('Bearer minted-token')
  })

  it('refuses a request carrying neither inline credentials nor a token, before any call', async () => {
    await expect(
      requestZoomInfo({ ...REQUEST, clientId: 'client-only' }, 'request-2')
    ).rejects.toMatchObject({ status: 400 })
    expect(mockSecureFetchWithValidation).not.toHaveBeenCalled()
  })

  it.each([
    ['a blank', '   ', 'client-blank-token'],
    ['a non-string', 123, 'client-numeric-token'],
  ])(
    'refuses %s access token in the token response before calling the API',
    async (_case, token, clientId) => {
      mockSecureFetchWithValidation.mockResolvedValue(
        Response.json({ access_token: token, expires_in: 3600 })
      )

      await expect(
        requestZoomInfo({ ...REQUEST, clientId, clientSecret: 'secret' }, 'request-4')
      ).rejects.toMatchObject({
        message: 'ZoomInfo token response missing access_token',
        status: 500,
      })
      expect(mockSecureFetchWithValidation).toHaveBeenCalledTimes(1)
    }
  )

  it('keeps reporting an inline token refusal exactly as before', async () => {
    mockSecureFetchWithValidation.mockResolvedValue(
      Response.json({ error: 'invalid_client' }, { status: 401 })
    )

    await expect(
      requestZoomInfo({ ...REQUEST, clientId: 'client', clientSecret: 'secret' }, 'request-3')
    ).rejects.toMatchObject({
      message: 'ZoomInfo token request failed: HTTP 401',
      status: 500,
      providerStatus: undefined,
    })
  })
})
