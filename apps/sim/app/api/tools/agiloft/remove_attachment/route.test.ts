/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  hybridAuthMockFns,
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { POST } from '@/app/api/tools/agiloft/remove_attachment/route'

/** Obvious non-secret so credential scanners do not flag these fixtures. */
const PLACEHOLDER_PASSWORD = 'not-a-real-password'

const PINNED_IP = '93.184.216.34'

const baseBody = {
  instanceUrl: 'https://example.agiloft.com',
  knowledgeBase: 'demo',
  login: 'admin',
  password: PLACEHOLDER_PASSWORD,
  table: 'contracts',
  recordId: '42',
  fieldName: 'attachments',
  position: '0',
}

function mockSecureFetchResponse(body: { ok?: boolean; json?: unknown; text?: string }) {
  return {
    ok: body.ok ?? true,
    status: 200,
    statusText: '',
    headers: new Headers(),
    body: null,
    text: async () => body.text ?? JSON.stringify(body.json ?? {}),
    json: async () => body.json ?? {},
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
    success: true,
    userId: 'user-1',
    authType: 'internal_jwt',
  })
  inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
    isValid: true,
    resolvedIP: PINNED_IP,
    originalHostname: 'example.agiloft.com',
  })
})

describe('POST /api/tools/agiloft/remove_attachment', () => {
  it('calls EWRemoveAttachment with GET, the only verb it accepts besides POST', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      mockSecureFetchResponse({ text: "EWREST_attachments.length='2';" })
    )

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(200)

    const data = (await response.json()) as {
      success: boolean
      output: { remainingAttachments: number }
    }
    expect(data.output.remainingAttachments).toBe(2)

    /**
     * One call, not three: the EW* surface rejects the bearer token, so it
     * authenticates from inline credentials and needs no login/logout pair.
     */
    const calls = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toContain('/ewws/EWRemoveAttachment')
    expect(calls[0][0]).toContain('&$login=admin')
    expect(calls[0][2]).toMatchObject({ method: 'GET' })
  })
})
