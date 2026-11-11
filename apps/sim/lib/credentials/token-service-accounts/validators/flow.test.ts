import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { EgressRefusedError } from '@/lib/core/network/transport.server'
import { validateFlowServiceAccount } from '@/lib/credentials/token-service-accounts/validators/flow'

const fields = { apiToken: 'tok', domain: 'flow.internal', providerWorkspaceId: 'ws-1' }

describe('validateFlowServiceAccount', () => {
  it('reports a host the egress policy refuses as the user input, not a retryable outage', async () => {
    inputValidationMockFns.mockSecureFetchWithValidation.mockRejectedValue(
      new EgressRefusedError('url resolves to a private address')
    )

    await expect(validateFlowServiceAccount(fields)).rejects.toMatchObject({
      code: 'host_not_allowed',
      status: 400,
    })
  })

  it('reports a host that does not exist as not found', async () => {
    inputValidationMockFns.mockSecureFetchWithValidation.mockRejectedValue(
      new Error('url hostname could not be resolved', {
        cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }),
      })
    )

    await expect(validateFlowServiceAccount(fields)).rejects.toMatchObject({
      code: 'site_not_found',
      status: 400,
    })
  })
})
