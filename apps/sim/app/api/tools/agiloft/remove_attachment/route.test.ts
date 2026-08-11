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

const PINNED_IP = '93.184.216.34'

const baseBody = {
  instanceUrl: 'https://example.agiloft.com',
  knowledgeBase: 'demo',
  login: 'admin',
  password: 'secret',
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
    text: async () => body.text ?? '',
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
    inputValidationMockFns.mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(mockSecureFetchResponse({ json: { access_token: 'tok-rm' } }))
      .mockResolvedValueOnce(mockSecureFetchResponse({ text: '2' }))
      .mockResolvedValueOnce(mockSecureFetchResponse({}))

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(200)

    const data = (await response.json()) as {
      success: boolean
      output: { remainingAttachments: number }
    }
    expect(data.output.remainingAttachments).toBe(2)

    const operationCall = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls[1]
    expect(operationCall[0]).toContain('/ewws/EWRemoveAttachment')
    expect(operationCall[2]).toMatchObject({ method: 'GET' })
  })
})
