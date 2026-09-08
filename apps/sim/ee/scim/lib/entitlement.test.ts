/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnterprisePlan } = vi.hoisted(() => ({ mockEnterprisePlan: vi.fn() }))

vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationOnEnterprisePlan: mockEnterprisePlan,
}))

import { isScimEntitledForOrganization } from '@/ee/scim/lib/entitlement'

afterEach(resetEnvFlagsMock)

describe('isScimEntitledForOrganization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnterprisePlan.mockResolvedValue(true)
  })

  it('is false whenever the deployment flag is off, whatever the plan says', async () => {
    setEnvFlags({ isScimEnabled: false, isHosted: true })
    await expect(isScimEntitledForOrganization('org-1')).resolves.toBe(false)
    expect(mockEnterprisePlan).not.toHaveBeenCalled()
  })

  it('is entitled by the flag alone on a self-hosted deployment', async () => {
    setEnvFlags({ isScimEnabled: true, isHosted: false })
    mockEnterprisePlan.mockResolvedValue(false)
    await expect(isScimEntitledForOrganization('org-1')).resolves.toBe(true)
    expect(mockEnterprisePlan).not.toHaveBeenCalled()
  })

  it('requires the enterprise plan on the hosted product', async () => {
    setEnvFlags({ isScimEnabled: true, isHosted: true })
    mockEnterprisePlan.mockResolvedValue(false)
    await expect(isScimEntitledForOrganization('org-1')).resolves.toBe(false)
    mockEnterprisePlan.mockResolvedValue(true)
    await expect(isScimEntitledForOrganization('org-1')).resolves.toBe(true)
    expect(mockEnterprisePlan).toHaveBeenCalledWith('org-1')
  })
})
