/**
 * @vitest-environment node
 */
import { resetUrlsMock, urlsMockFns } from '@sim/testing'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

afterAll(resetUrlsMock)

const { mockToken } = vi.hoisted(() => ({
  mockToken: vi.fn(),
}))

vi.mock('@/lib/auth/internal', () => ({ generateInternalToken: mockToken }))

import { validatePIIViaHttp } from '@/lib/guardrails/validation-client'

describe('validatePIIViaHttp', () => {
  const mockBaseUrl = urlsMockFns.mockGetInternalApiBaseUrl
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockToken.mockResolvedValue('internal-token')
    mockBaseUrl.mockReturnValue('https://app.example.com')
    fetchMock = vi.fn(async () =>
      Response.json({ passed: true, detectedEntities: [], maskedText: 'clean' })
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls the authenticated app capability with the caller signal', async () => {
    const controller = new AbortController()

    await expect(
      validatePIIViaHttp(
        {
          text: 'clean',
          entityTypes: ['EMAIL_ADDRESS'],
          mode: 'mask',
          language: 'en',
        },
        controller.signal
      )
    ).resolves.toEqual({ passed: true, detectedEntities: [], maskedText: 'clean' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.example.com/api/guardrails/pii/validate',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer internal-token',
        },
        signal: controller.signal,
      })
    )
  })

  it('fails on an HTTP error without retrying', async () => {
    fetchMock.mockResolvedValueOnce(new Response('unavailable', { status: 503 }))

    await expect(
      validatePIIViaHttp({ text: 'claim', entityTypes: [], mode: 'block' })
    ).rejects.toThrow('PII validation request failed (503): unavailable')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('fails when the endpoint returns an invalid success body', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ passed: true }))

    await expect(
      validatePIIViaHttp({ text: 'claim', entityTypes: [], mode: 'block' })
    ).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
