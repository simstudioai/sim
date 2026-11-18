import { jsonResponse } from '@sim/testing'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

const { mockSecureFetchWithPinnedIP, mockValidateUrlWithDNS } = inputValidationMockFns

import { submitPulseParse } from '@/lib/internal/pulse/client'

function requestTo(url: string) {
  const call = mockSecureFetchWithPinnedIP.mock.calls.find(([target]) => target === url)
  if (!call) throw new Error(`No request to ${url}`)
  return call[2] as { headers: Record<string, string> }
}

describe('submitPulseParse large results', () => {
  beforeEach(() => {
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
  })

  it('downloads the full result when Pulse answers with a result URL', async () => {
    const resultUrl = 'https://api.runpulse.com/results/job-1'
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(jsonResponse({ is_url: true, url: resultUrl, extraction_id: 'ext-1' }))
      .mockResolvedValueOnce(jsonResponse({ markdown: '# Report', page_count: 120 }))

    const result = await submitPulseParse('pulse-key', new FormData())

    expect(result).toEqual({ extraction_id: 'ext-1', markdown: '# Report', page_count: 120 })
    expect(requestTo(resultUrl).headers).toEqual({ 'x-api-key': 'pulse-key' })
  })

  it('does not send the API key to a presigned storage URL', async () => {
    const resultUrl = 'https://storage.example.com/results/job-1?signature=abc'
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(jsonResponse({ is_url: true, url: resultUrl, extraction_id: 'ext-1' }))
      .mockResolvedValueOnce(jsonResponse({ markdown: '# Report' }))

    await submitPulseParse('pulse-key', new FormData())

    expect(requestTo(resultUrl).headers).toEqual({})
  })
})
