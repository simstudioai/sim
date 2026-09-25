import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  secureFetch: vi.fn(),
  validateUrl: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ error: mocks.loggerError }),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  MAX_JSON_API_RESPONSE_BYTES: 10 * 1024 * 1024,
  secureFetchWithPinnedIP: mocks.secureFetch,
  validateUrlWithDNS: mocks.validateUrl,
}))

import { submitExtendParse } from '@/lib/internal/extend/client'
import { ExtendOperationError } from '@/lib/internal/extend/errors'

describe('submitExtendParse', () => {
  beforeEach(() => {
    mocks.validateUrl.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
  })

  it('maps transport failures to a provider-unavailable response without exposing details', async () => {
    mocks.secureFetch.mockRejectedValue(new Error('TLS handshake exposed private details'))

    await expect(submitExtendParse('key', { file: {} })).rejects.toEqual(
      new ExtendOperationError(502, {
        success: false,
        error: 'Failed to reach Extend API',
      })
    )
    expect(mocks.loggerError).toHaveBeenCalledWith('Extend API request failed', {
      errorName: 'Error',
    })
    expect(JSON.stringify(mocks.loggerError.mock.calls)).not.toContain('private details')
  })
})
