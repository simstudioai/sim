import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)

import { isScimEntitledForOrganization } from '@/ee/scim/lib/entitlement'

const mockEnterprisePlan = billingSubscriptionMockFns.mockIsOrganizationOnEnterprisePlan

afterEach(resetEnvFlagsMock)

describe('isScimEntitledForOrganization', () => {
  beforeEach(() => {
    mockEnterprisePlan.mockResolvedValue(true)
  })

  it('is off on a self-hosted deployment that has not turned it on', async () => {
    setEnvFlags({ isScimEnabled: false, isHosted: false })
    await expect(isScimEntitledForOrganization('org-1')).resolves.toBe(false)
    expect(mockEnterprisePlan).not.toHaveBeenCalled()
  })

  it('honors the deployment disable flag on the hosted product', async () => {
    setEnvFlags({ isScimEnabled: false, isHosted: true })
    await expect(isScimEntitledForOrganization('org-1')).resolves.toBe(false)
    expect(mockEnterprisePlan).not.toHaveBeenCalled()
  })

  it('requires an enterprise plan when provisioning is enabled on the hosted product', async () => {
    setEnvFlags({ isScimEnabled: true, isHosted: true })
    mockEnterprisePlan.mockResolvedValue(false)
    await expect(isScimEntitledForOrganization('org-1')).resolves.toBe(false)
    mockEnterprisePlan.mockResolvedValue(true)
    await expect(isScimEntitledForOrganization('org-1')).resolves.toBe(true)
    expect(mockEnterprisePlan).toHaveBeenCalledWith('org-1', 'throw', undefined)
  })

  it('propagates billing read failures instead of treating the organization as unentitled', async () => {
    setEnvFlags({ isScimEnabled: true, isHosted: true })
    const failure = new Error('Billing database unavailable')
    mockEnterprisePlan.mockRejectedValue(failure)
    await expect(isScimEntitledForOrganization('org-1')).rejects.toBe(failure)
  })
})
