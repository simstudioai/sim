import type { PersonalApiKeyPrincipal, SessionPrincipal } from '@sim/auth/principal'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import { dbChainMockFns } from '@sim/testing/mocks/database.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineAuthorizedOrganizationBillingSummaryUseCase } from '@/lib/billing/application/organization-billing-summary/authorized-organization-billing-summary-use-case'
import { organizationBillingSummaryOperations } from '@/lib/billing/application/organization-billing-summary/operations'
import { ForbiddenOperationError } from '@/lib/core/application'

const mocks = {
  membership: dbChainMockFns.limit,
  execute: vi.fn(),
}

const session = createSessionPrincipal()
const personalKey = createPersonalApiKeyPrincipal()

const useCase = defineAuthorizedOrganizationBillingSummaryUseCase({
  operation: organizationBillingSummaryOperations.read,
  organizationId: (input: { organizationId: string }) => input.organizationId,
  execute: mocks.execute,
})

function run(principal: SessionPrincipal | PersonalApiKeyPrincipal = session) {
  return useCase.execute({ principal, input: { organizationId: 'org-1' } })
}

async function refusalCode(promise: Promise<unknown>) {
  try {
    await promise
    throw new Error('Expected the billing summary read to be refused')
  } catch (error) {
    expect(error).toBeInstanceOf(ForbiddenOperationError)
    return (error as ForbiddenOperationError).detailCode
  }
}

describe('organization billing summary authorization', () => {
  beforeEach(() => {
    mocks.membership.mockResolvedValue([{ role: 'owner' }])
    mocks.execute.mockResolvedValue({ ok: true })
  })

  it('rejects API keys before loading protected organization membership', async () => {
    expect(await refusalCode(run(personalKey))).toBe('PRINCIPAL_KIND_NOT_PERMITTED')
    expect(mocks.membership).not.toHaveBeenCalled()
  })

  it('distinguishes a non-member from a member without billing authority', async () => {
    mocks.membership.mockResolvedValueOnce([])
    expect(await refusalCode(run())).toBe('ORGANIZATION_MEMBERSHIP_REQUIRED')

    mocks.membership.mockResolvedValueOnce([{ role: 'member' }])
    expect(await refusalCode(run())).toBe('ORGANIZATION_ADMIN_REQUIRED')
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
