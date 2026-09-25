import { resetUrlsMock, urlsMockFns } from '@sim/testing'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

afterAll(resetUrlsMock)

const { mockToken } = vi.hoisted(() => ({
  mockToken: vi.fn(),
}))

vi.mock('@/lib/auth/internal', () => ({ generateInternalToken: mockToken }))

import { MAX_PII_VALIDATION_RESPONSE_BYTES } from '@/lib/guardrails/pii-limits'
import { validatePIIViaHttp } from '@/lib/guardrails/validation-client'

describe('validatePIIViaHttp', () => {
  const mockBaseUrl = urlsMockFns.mockGetInternalApiBaseUrl
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
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

  it('fails before parsing an oversized success body', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"passed":true}', {
        headers: { 'content-length': String(MAX_PII_VALIDATION_RESPONSE_BYTES + 1) },
      })
    )

    await expect(
      validatePIIViaHttp({ text: 'claim', entityTypes: [], mode: 'block' })
    ).rejects.toThrow('PII validation response exceeds maximum size')
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
