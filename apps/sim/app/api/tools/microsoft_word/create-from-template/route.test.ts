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

import { POST } from '@/app/api/tools/microsoft_word/create-from-template/route'

const { mockValidateUrlWithDNS, mockSecureFetchWithPinnedIP } = inputValidationMockFns

const baseBody = {
  accessToken: 'token-123',
  templateDocumentId: 'template-abc',
  name: 'Acme Agreement',
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
    resolvedIP: '93.184.216.34',
    originalHostname: 'graph.microsoft.com',
  })
})

describe('POST /api/tools/microsoft_word/create-from-template', () => {
  it('rejects an empty placeholder key rather than failing mid-rewrite', async () => {
    // A blank placeholder would match at every position in the document.
    const response = await POST(
      createMockRequest('POST', { ...baseBody, replacements: { '': 'Acme Corp' } })
    )

    expect(response.status).toBe(400)
    const data = (await response.json()) as { error?: string }
    expect(JSON.stringify(data)).toMatch(/placeholder/i)
    expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })

  it('rejects an empty placeholder key inside the JSON-string form too', async () => {
    const response = await POST(
      createMockRequest('POST', { ...baseBody, replacements: '{"  ": "Acme Corp"}' })
    )

    expect(response.status).toBe(400)
    expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })

  it('rejects a replacements value that is not an object mapping', async () => {
    const response = await POST(
      createMockRequest('POST', { ...baseBody, replacements: '["a","b"]' })
    )

    expect(response.status).toBe(400)
    expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })
})
