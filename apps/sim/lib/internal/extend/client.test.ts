import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

const { mockSecureFetchWithPinnedIP, mockValidateUrlWithDNS } = inputValidationMockFns
const { error: mockLoggerError } = getMockLogger('ExtendClient')

import { submitExtendParse } from '@/lib/internal/extend/client'
import { ExtendOperationError } from '@/lib/internal/extend/errors'

describe('submitExtendParse', () => {
  beforeEach(() => {
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
  })

  it('maps transport failures to a provider-unavailable response without exposing details', async () => {
    mockSecureFetchWithPinnedIP.mockRejectedValue(
      new Error('TLS handshake exposed private details')
    )

    await expect(submitExtendParse('key', { file: {} })).rejects.toEqual(
      new ExtendOperationError(502, {
        success: false,
        error: 'Failed to reach Extend API',
      })
    )
    expect(mockLoggerError).toHaveBeenCalledWith('Extend API request failed', {
      errorName: 'Error',
    })
    expect(JSON.stringify(mockLoggerError.mock.calls)).not.toContain('private details')
  })
})
