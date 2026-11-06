import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { describe, expect, it, vi } from 'vitest'
import { mintJamaServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/jama'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

describe('Jama credential validation', () => {
  it.each([
    ['ENOTFOUND', 'site_not_found', 400],
    ['EAI_AGAIN', 'provider_unavailable', 502],
    ['ETIMEDOUT', 'provider_unavailable', 502],
  ])(
    'classifies %s without treating transient failures as a wrong instance',
    async (code, expectedCode, status) => {
      inputValidationMockFns.mockSecureFetchWithValidation.mockRejectedValueOnce(
        new Error('url hostname could not be resolved', {
          cause: Object.assign(new Error('DNS lookup failed'), { code }),
        })
      )

      await expect(
        mintJamaServiceAccountToken({
          orgId: 'https://example.jamacloud.com',
          clientId: 'client-id',
          clientSecret: 'client-secret',
        })
      ).rejects.toMatchObject({ code: expectedCode, status })
    }
  )
})
