import { jsonResponse } from '@sim/testing'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

const { mockSecureFetchWithPinnedIP, mockValidateUrlWithDNS } = inputValidationMockFns

import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { submitPulseParse } from '@/lib/internal/pulse/client'
import { MAX_TOOL_RESPONSE_BODY_BYTES } from '@/lib/internal/tool-operations/response-limits'

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

  it('does not send the API key to the Pulse host over plain HTTP', async () => {
    const resultUrl = 'http://api.runpulse.com/results/job-1'
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(jsonResponse({ is_url: true, url: resultUrl, extraction_id: 'ext-1' }))
      .mockResolvedValueOnce(jsonResponse({ markdown: '# Report' }))

    await submitPulseParse('pulse-key', new FormData())

    expect(requestTo(resultUrl).headers).toEqual({})
  })

  it('fails with a clear error when the full result is too large to return', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(
        jsonResponse({ is_url: true, url: 'https://api.runpulse.com/results/job-1' })
      )
      .mockRejectedValueOnce(
        new PayloadSizeLimitError({
          label: 'response body',
          maxBytes: MAX_TOOL_RESPONSE_BODY_BYTES,
        })
      )

    await expect(submitPulseParse('pulse-key', new FormData())).rejects.toMatchObject({
      status: 413,
      body: { success: false, error: expect.stringContaining('too large') },
    })
  })
})
