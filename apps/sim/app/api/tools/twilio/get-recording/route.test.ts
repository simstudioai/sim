/**
 * @vitest-environment node
 *
 * Guards the provider URL this route builds from caller-supplied values.
 *
 * `accountSid` and `recordingSid` are NOT credential-derived — the tool body is
 * `{accountSid, authToken, recordingSid}` (`tools/twilio_voice/get_recording.ts`)
 * and `recordingSid` is `visibility: 'user-or-llm'`, so prompt injection controls
 * it. The contract only enforces `.min(1)`, and `validateUrlWithDNS` pins the
 * *host*, not the path. Before the guard, `recordingSid = '../Messages'` resolved
 * `/2010-04-01/Accounts/{acct}/Recordings/../Messages.json` down to
 * `/2010-04-01/Accounts/{acct}/Messages.json`; the route then follows `data.uri`,
 * refetches it with the caller's Basic auth, and returns the body base64-encoded
 * as a `file` output — an arbitrary authenticated GET across the caller's Twilio
 * account, exfiltrated as an attachment.
 *
 * Every URL assertion resolves through `new URL(...)` — the same normalization
 * `fetch` performs — and compares the full decoded `pathname` segment list.
 */
import {
  createMockRequest,
  hybridAuthMockFns,
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { MAX_TWILIO_RECORDING_BYTES, POST } from '@/app/api/tools/twilio/get-recording/route'

const { mockValidateUrlWithDNS, mockSecureFetchWithPinnedIP } = inputValidationMockFns

const PINNED_IP = '3.89.10.20'

/** A real Twilio SID: a two-letter prefix followed by 32 hexadecimal digits. */
const ACCOUNT_SID = `AC${'a'.repeat(32)}`
const RECORDING_SID = 'RE0123456789abcdef0123456789abcdef'

const baseBody = {
  accountSid: ACCOUNT_SID,
  authToken: 'auth-token',
  recordingSid: RECORDING_SID,
}

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 400,
    statusText: '',
    headers: new Headers(),
    body: null,
    text: async () => JSON.stringify(body),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

function mediaResponse(bytes: number) {
  return {
    ok: true,
    status: 200,
    statusText: '',
    headers: new Headers({ 'content-type': 'audio/wav' }),
    body: null,
    text: async () => '',
    json: async () => ({}),
    arrayBuffer: async () => new ArrayBuffer(bytes),
  }
}

const recordingPayload = {
  sid: RECORDING_SID,
  call_sid: 'CA0123456789abcdef0123456789abcdef',
  duration: '12',
  status: 'completed',
  uri: `/2010-04-01/Accounts/${ACCOUNT_SID}/Recordings/${RECORDING_SID}.json`,
}

beforeEach(() => {
  vi.clearAllMocks()
  hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
    success: true,
    userId: 'user-1',
    authType: 'internal_jwt',
  })
  mockValidateUrlWithDNS.mockResolvedValue({
    isValid: true,
    resolvedIP: PINNED_IP,
    originalHostname: 'api.twilio.com',
  })
})

/** Vectors that must never reach `secureFetchWithPinnedIP` at all. */
const REJECTED_SIDS = [
  '..',
  '.',
  '  ..  ',
  '%2e%2e',
  'a/b',
  '../Messages',
  '..\\..',
  'RE0123456789abcdef0123456789abcdef/../../Messages',
  'RE0123456789abcdef0123456789abcdef?PageSize=1000',
  'RE0123456789abcdef0123456789abcdef.json',
  'RE0123456789abcdef0123456789abcdefEXTRA',
  'REzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
] as const

describe('POST /api/tools/twilio/get-recording — recordingSid guard', () => {
  it.each(REJECTED_SIDS)(
    'rejects recordingSid %j with a 400 and issues no request',
    async (sid) => {
      const response = await POST(createMockRequest('POST', { ...baseBody, recordingSid: sid }))

      expect(response.status).toBe(400)
      const data = (await response.json()) as { success: boolean; error: string }
      expect(data.success).toBe(false)
      expect(data.error).toMatch(/Recording SID/i)
      expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
    }
  )

  it.each(['..', 'a/b', `AC${'0123456789abcdef'.repeat(2)}/../..`, 'ACnothex'] as const)(
    'rejects accountSid %j with a 400 and issues no request',
    async (sid) => {
      const response = await POST(createMockRequest('POST', { ...baseBody, accountSid: sid }))

      expect(response.status).toBe(400)
      const data = (await response.json()) as { success: boolean; error: string }
      expect(data.success).toBe(false)
      expect(data.error).toMatch(/Account SID/i)
      expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
    }
  )
})

describe('POST /api/tools/twilio/get-recording — legitimate values', () => {
  it('builds byte-identical Twilio URLs for real SIDs', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(jsonResponse(recordingPayload))
      .mockResolvedValueOnce(jsonResponse({ transcriptions: [] }))
      .mockResolvedValueOnce(mediaResponse(2048))

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(200)

    const infoUrl = mockSecureFetchWithPinnedIP.mock.calls[0][0] as string
    expect(infoUrl).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Recordings/${RECORDING_SID}.json`
    )
    const resolvedInfo = new URL(infoUrl)
    expect(resolvedInfo.origin).toBe('https://api.twilio.com')
    expect(resolvedInfo.search).toBe('')
    expect(resolvedInfo.pathname.split('/').map(decodeURIComponent)).toEqual([
      '',
      '2010-04-01',
      'Accounts',
      ACCOUNT_SID,
      'Recordings',
      `${RECORDING_SID}.json`,
    ])

    const transcriptionUrl = new URL(mockSecureFetchWithPinnedIP.mock.calls[1][0] as string)
    expect(transcriptionUrl.pathname.split('/').map(decodeURIComponent)).toEqual([
      '',
      '2010-04-01',
      'Accounts',
      ACCOUNT_SID,
      'Transcriptions.json',
    ])
    expect(transcriptionUrl.searchParams.get('RecordingSid')).toBe(RECORDING_SID)

    const data = (await response.json()) as { success: boolean; output: { file: { size: number } } }
    expect(data.success).toBe(true)
    expect(data.output.file.size).toBe(2048)
  })

  it('keeps a Twilio-supplied sid inside the query zone via URLSearchParams', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(jsonResponse({ ...recordingPayload, sid: 'RE&PageSize=1000' }))
      .mockResolvedValueOnce(jsonResponse({ transcriptions: [] }))
      .mockResolvedValueOnce(mediaResponse(16))

    await POST(createMockRequest('POST', baseBody))

    const transcriptionUrl = new URL(mockSecureFetchWithPinnedIP.mock.calls[1][0] as string)
    expect(transcriptionUrl.searchParams.get('RecordingSid')).toBe('RE&PageSize=1000')
    expect(transcriptionUrl.searchParams.get('PageSize')).toBeNull()
    expect([...transcriptionUrl.searchParams.keys()]).toEqual(['RecordingSid'])
  })
})

describe('POST /api/tools/twilio/get-recording — media size cap', () => {
  it('caps the media download at the size the JSON transport can actually carry', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(jsonResponse(recordingPayload))
      .mockResolvedValueOnce(jsonResponse({ transcriptions: [] }))
      .mockResolvedValueOnce(mediaResponse(64))

    await POST(createMockRequest('POST', baseBody))

    expect(MAX_TWILIO_RECORDING_BYTES).toBeLessThanOrEqual(7.5 * 1024 * 1024)
    expect(mockSecureFetchWithPinnedIP.mock.calls[2][2]).toMatchObject({
      maxResponseBytes: MAX_TWILIO_RECORDING_BYTES,
    })
  })
})

describe('POST /api/tools/twilio/get-recording — over-limit media', () => {
  /**
   * The cap is enforced by `secureFetchWithPinnedIP` while the body streams, so
   * it surfaces as a rejected promise *inside* the media `try`. A blanket
   * `catch` there logged a warning and fell through to the success response
   * with `file` simply absent — indistinguishable, to the caller, from a
   * recording that has no media yet. An unavailable recording must never look
   * like a retrieved one.
   */
  it('returns an explicit failure, not success-with-no-file, when the media exceeds the cap', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(jsonResponse(recordingPayload))
      .mockResolvedValueOnce(jsonResponse({ transcriptions: [] }))
      .mockRejectedValueOnce(
        new PayloadSizeLimitError({
          label: 'response body',
          maxBytes: MAX_TWILIO_RECORDING_BYTES,
          observedBytes: MAX_TWILIO_RECORDING_BYTES + 1,
        })
      )

    const response = await POST(createMockRequest('POST', baseBody))

    expect(response.status).toBe(413)
    const data = (await response.json()) as {
      success: boolean
      error?: string
      output?: { file?: unknown }
    }
    expect(data.success).toBe(false)
    expect(data.error).toBeTruthy()
    expect(data.error).toMatch(new RegExp(String(MAX_TWILIO_RECORDING_BYTES)))
    expect(data.output?.file).toBeUndefined()
  })

  it('still degrades to success-without-file for the other media errors that catch exists for', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(jsonResponse(recordingPayload))
      .mockResolvedValueOnce(jsonResponse({ transcriptions: [] }))
      .mockRejectedValueOnce(new Error('socket hang up'))

    const response = await POST(createMockRequest('POST', baseBody))

    expect(response.status).toBe(200)
    const data = (await response.json()) as {
      success: boolean
      output: { file?: unknown; mediaUrl?: string }
    }
    expect(data.success).toBe(true)
    expect(data.output.file).toBeUndefined()
    expect(data.output.mediaUrl).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Recordings/${RECORDING_SID}`
    )
  })

  it('still degrades to success-without-file when media URL validation fails', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(jsonResponse(recordingPayload))
      .mockResolvedValueOnce(jsonResponse({ transcriptions: [] }))
    mockValidateUrlWithDNS
      .mockResolvedValueOnce({ isValid: true, resolvedIP: PINNED_IP })
      .mockResolvedValueOnce({ isValid: true, resolvedIP: PINNED_IP })
      .mockResolvedValueOnce({ isValid: false, error: 'blocked host' })

    const response = await POST(createMockRequest('POST', baseBody))

    expect(response.status).toBe(200)
    const data = (await response.json()) as { success: boolean; output: { file?: unknown } }
    expect(data.success).toBe(true)
    expect(data.output.file).toBeUndefined()
  })
})
