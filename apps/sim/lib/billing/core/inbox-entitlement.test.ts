import { billingAccessMock, billingAccessMockFns } from '@sim/testing/mocks/billing-access.mock'
import { billingCoreMock, billingCoreMockFns } from '@sim/testing/mocks/billing-core.mock'
import { billingPlanMock, billingPlanMockFns } from '@sim/testing/mocks/billing-plan.mock'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { resetEnvMock, setEnv } from '@sim/testing/mocks/env.mock'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/core/plan', () => billingPlanMock)

vi.mock('@/lib/billing/core/billing', () => billingCoreMock)

vi.mock('@/lib/billing/core/access', () => billingAccessMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import {
  hasWorkspaceInboxAccess,
  hasWorkspaceInboxGraceAccess,
} from '@/lib/billing/core/subscription'

const { mockGetWorkspaceWithOwner } = permissionsMockFns
const mockGetPersonalSubscription = billingPlanMockFns.mockGetHighestPriorityPersonalSubscription
const mockGetOrganizationSubscription = billingCoreMockFns.mockGetOrganizationSubscription
const { mockGetEffectiveBillingStatus, mockIsOrganizationBillingBlocked } = billingAccessMockFns

beforeEach(() => {
  resetDbChainMock()
  setEnv({ COPILOT_API_KEY: 'test-copilot-key' })
  setEnvFlags({ isHosted: true, isBillingEnabled: true, isInboxEnabled: false })
  mockGetWorkspaceWithOwner.mockResolvedValue({
    id: 'workspace-1',
    billedAccountUserId: 'payer-1',
    organizationId: null,
  })
  mockGetPersonalSubscription.mockResolvedValue(null)
  mockGetOrganizationSubscription.mockResolvedValue(null)
  mockGetEffectiveBillingStatus.mockResolvedValue({
    billingBlocked: false,
    billingBlockedReason: null,
    blockedByOrgOwner: false,
  })
  mockIsOrganizationBillingBlocked.mockResolvedValue(false)
})

afterEach(() => {
  resetEnvFlagsMock()
  resetEnvMock()
})

describe('Sim Mailer hosted entitlement', () => {
  it.each([
    { isInboxEnabled: true, isBillingEnabled: true },
    { isInboxEnabled: false, isBillingEnabled: false },
    { isInboxEnabled: true, isBillingEnabled: false },
  ])('requires a qualifying payer despite deployment flags %o', async (flags) => {
    setEnvFlags(flags)

    await expect(hasWorkspaceInboxAccess('workspace-1')).resolves.toBe(false)
    await expect(hasWorkspaceInboxGraceAccess('workspace-1')).resolves.toBe(false)
    expect(mockGetPersonalSubscription).toHaveBeenCalledWith('payer-1')
  })

  it.each([
    ['pro_25000', true],
    ['enterprise', true],
    ['pro_6000', false],
    ['pro', false],
    ['free', false],
  ])('checks the personal workspace payer plan %s', async (plan, expected) => {
    mockGetPersonalSubscription.mockResolvedValue({ plan, status: 'active' })

    await expect(hasWorkspaceInboxAccess('workspace-1')).resolves.toBe(expected)
    await expect(hasWorkspaceInboxGraceAccess('workspace-1')).resolves.toBe(expected)
  })

  it.each([
    ['team_25000', true],
    ['enterprise', true],
    ['team_6000', false],
  ])(
    'checks the organization payer plan %s without requiring a personal plan',
    async (plan, expected) => {
      mockGetWorkspaceWithOwner.mockResolvedValue({
        id: 'workspace-1',
        billedAccountUserId: 'payer-1',
        organizationId: 'org-1',
      })
      dbChainMockFns.limit.mockResolvedValueOnce([{ plan, status: 'active' }])
      mockGetOrganizationSubscription.mockResolvedValue({ plan, status: 'active' })

      await expect(hasWorkspaceInboxAccess('workspace-1')).resolves.toBe(expected)
      await expect(hasWorkspaceInboxGraceAccess('workspace-1')).resolves.toBe(expected)
      expect(mockGetPersonalSubscription).not.toHaveBeenCalled()
      expect(mockGetOrganizationSubscription).toHaveBeenCalledWith('org-1', { onError: 'throw' })
    }
  )

  it('blocks a past-due Max payer from use while preserving provisioned resources', async () => {
    mockGetPersonalSubscription.mockResolvedValue({ plan: 'pro_25000', status: 'past_due' })

    await expect(hasWorkspaceInboxAccess('workspace-1')).resolves.toBe(false)
    await expect(hasWorkspaceInboxGraceAccess('workspace-1')).resolves.toBe(true)
  })

  it('blocks a billing-blocked Max payer from use while preserving provisioned resources', async () => {
    mockGetPersonalSubscription.mockResolvedValue({ plan: 'pro_25000', status: 'active' })
    mockGetEffectiveBillingStatus.mockResolvedValue({ billingBlocked: true })

    await expect(hasWorkspaceInboxAccess('workspace-1')).resolves.toBe(false)
    await expect(hasWorkspaceInboxGraceAccess('workspace-1')).resolves.toBe(true)
  })

  it('requires the execution key for use without destroying resources when it is missing', async () => {
    setEnv({ COPILOT_API_KEY: undefined })
    mockGetPersonalSubscription.mockResolvedValue({ plan: 'pro_25000', status: 'active' })

    await expect(hasWorkspaceInboxAccess('workspace-1')).resolves.toBe(false)
    await expect(hasWorkspaceInboxGraceAccess('workspace-1')).resolves.toBe(true)
  })
})

describe('Sim Mailer cleanup uncertainty', () => {
  it('preserves the inbox if the workspace cannot be found', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue(null)

    await expect(hasWorkspaceInboxGraceAccess('workspace-1')).resolves.toBe(true)
  })

  it('requires the personal subscription reader to surface errors and preserves the inbox', async () => {
    mockGetPersonalSubscription.mockRejectedValue(new Error('Database unavailable'))

    await expect(hasWorkspaceInboxGraceAccess('workspace-1')).resolves.toBe(true)
    expect(mockGetPersonalSubscription).toHaveBeenCalledWith('payer-1', { onError: 'throw' })
  })

  it('retains past-due Max for Teams resources', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      billedAccountUserId: 'payer-1',
      organizationId: 'org-1',
    })
    mockGetOrganizationSubscription.mockResolvedValue({ plan: 'team_25000', status: 'past_due' })

    await expect(hasWorkspaceInboxGraceAccess('workspace-1')).resolves.toBe(true)
  })
})

describe('Sim Mailer self-hosted overrides', () => {
  it.each([
    { isInboxEnabled: true, isBillingEnabled: true },
    { isInboxEnabled: false, isBillingEnabled: false },
  ])('preserves self-hosted configuration %o', async (flags) => {
    setEnvFlags({ isHosted: false, ...flags })

    await expect(hasWorkspaceInboxAccess('workspace-1')).resolves.toBe(true)
    await expect(hasWorkspaceInboxGraceAccess('workspace-1')).resolves.toBe(true)
    expect(mockGetWorkspaceWithOwner).not.toHaveBeenCalled()
  })
})
