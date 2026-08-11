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

import { POST } from '@/app/api/tools/agiloft/create_record/route'

const PINNED_IP = '93.184.216.34'

const baseBody = {
  instanceUrl: 'https://example.agiloft.com',
  knowledgeBase: 'Demo',
  login: 'admin',
  password: 'secret',
  table: 'contacts.employees',
  data: JSON.stringify({ first_name: 'John', last_name: 'Doe' }),
}

function mockSecureFetchResponse(body: { ok?: boolean; json?: unknown; text?: string }) {
  return {
    ok: body.ok ?? true,
    status: body.ok === false ? 400 : 200,
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

describe('POST /api/tools/agiloft/create_record', () => {
  it("reads the record ID out of EWCreate's EWREST_id assignment", async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(mockSecureFetchResponse({ json: { access_token: 'tok-c' } }))
      .mockResolvedValueOnce(mockSecureFetchResponse({ text: "EWREST_id='353';" }))
      .mockResolvedValueOnce(mockSecureFetchResponse({}))

    const response = await POST(createMockRequest('POST', baseBody))
    const data = (await response.json()) as {
      success: boolean
      output: { id: string | null }
    }

    expect(data.success).toBe(true)
    expect(data.output.id).toBe('353')

    const operationCall = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls[1]
    expect(operationCall[0]).toContain('/ewws/EWCreate?')
    expect(operationCall[0]).toContain('&first_name=John')
    expect(operationCall[2]).toMatchObject({ method: 'POST' })
  })

  it('fails loudly when Agiloft answers 200 with something that is not an EWREST body', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(mockSecureFetchResponse({ json: { access_token: 'tok-c' } }))
      .mockResolvedValueOnce(
        mockSecureFetchResponse({ text: 'Error executing query, please consult logs' })
      )
      .mockResolvedValueOnce(mockSecureFetchResponse({}))

    const response = await POST(createMockRequest('POST', baseBody))
    const data = (await response.json()) as { success: boolean; error?: string }

    expect(data.success).toBe(false)
    expect(data.error).toContain('did not return a record ID')
  })

  it('rejects a data payload that is not a JSON object', async () => {
    const response = await POST(
      createMockRequest('POST', { ...baseBody, data: '["not", "an", "object"]' })
    )
    const data = (await response.json()) as { success: boolean; error?: string }

    expect(data.success).toBe(false)
    expect(data.error).toContain('must be a JSON object')
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })
})
