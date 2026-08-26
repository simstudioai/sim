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

import { POST } from '@/app/api/tools/microsoft_word/create/route'

const { mockValidateUrlWithDNS, mockSecureFetchWithPinnedIP } = inputValidationMockFns

const baseBody = {
  accessToken: 'token-123',
  name: 'Q3 Report',
  content: 'Hello',
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

describe('POST /api/tools/microsoft_word/create', () => {
  it('rejects a whitespace-only name as a client error, not a server error', async () => {
    // The contract's min(1) accepts a space; the name is only known to be
    // unusable once the extension helper trims it.
    const response = await POST(createMockRequest('POST', { ...baseBody, name: '   ' }))

    expect(response.status).toBe(400)
    const data = (await response.json()) as { success: boolean; error: string }
    expect(data.success).toBe(false)
    expect(data.error).toMatch(/Document name is required/)
    expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })

  it('rejects a malformed folder ID as a client error', async () => {
    const response = await POST(
      createMockRequest('POST', { ...baseBody, folderId: 'not a valid id' })
    )

    expect(response.status).toBe(400)
    const data = (await response.json()) as { success: boolean }
    expect(data.success).toBe(false)
    expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })

  it('rejects a malformed drive ID as a client error', async () => {
    const response = await POST(createMockRequest('POST', { ...baseBody, driveId: 'bad/../drive' }))

    expect(response.status).toBe(400)
    expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })
})
