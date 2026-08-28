/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  secureFetchWithPinnedIP: vi.fn(),
  validateUrlWithDNS: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithPinnedIP: mocks.secureFetchWithPinnedIP,
  validateUrlWithDNS: mocks.validateUrlWithDNS,
}))

import { getTwilioRecording } from '@/lib/internal/twilio-voice/operations'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

describe('getTwilioRecording', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
    mocks.secureFetchWithPinnedIP
      .mockResolvedValueOnce(
        Response.json({
          sid: 'RE123',
          call_sid: 'CA123',
          duration: '42',
          status: 'completed',
          channels: 1,
          source: 'RecordVerb',
          uri: '/2010-04-01/Accounts/AC123/Recordings/RE123.json',
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          transcriptions: [{ transcription_text: 'hello', status: 'completed' }],
        })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } })
      )
  })

  it('pins all provider requests and bounds the recording media', async () => {
    const controller = new AbortController()
    const result = await getTwilioRecording(
      { accountSid: 'AC123', authToken: 'secret', recordingSid: 'RE123' },
      { requestId: 'request-1', signal: controller.signal }
    )

    expect(mocks.secureFetchWithPinnedIP).toHaveBeenCalledTimes(3)
    expect(mocks.secureFetchWithPinnedIP.mock.calls[2][2]).toEqual(
      expect.objectContaining({
        maxResponseBytes: MAX_BUFFERED_TRANSFER_BYTES,
        signal: controller.signal,
      })
    )
    expect(result.output).toEqual(
      expect.objectContaining({
        duration: 42,
        transcriptionText: 'hello',
        file: expect.objectContaining({ name: 'RE123.mp3', data: 'AQID', size: 3 }),
      })
    )
  })
})
