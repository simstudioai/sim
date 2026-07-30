/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  schemaMock,
  setEnvFlags,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsOrganizationBillingBlocked } = vi.hoisted(() => ({
  mockIsOrganizationBillingBlocked: vi.fn(),
}))

vi.mock('@/lib/billing/core/access', () => ({
  isOrganizationBillingBlocked: mockIsOrganizationBillingBlocked,
}))

import { validateEnterpriseAuditAccess } from '@/app/api/v1/audit-logs/auth'

describe('enterprise audit access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsOrganizationBillingBlocked.mockResolvedValue(false)
  })

  afterAll(() => {
    resetDbChainMock()
    resetEnvFlagsMock()
  })

  describe('with billing enabled', () => {
    beforeEach(() => {
      setEnvFlags({ isBillingEnabled: true })
      queueTableRows(schemaMock.member, [{ organizationId: 'organization-route', role: 'admin' }])
      queueTableRows(schemaMock.subscription, [{ id: 'subscription-1' }])
      queueTableRows(schemaMock.member, [{ userId: 'viewer' }, { userId: 'member-2' }])
    })

    it('authorizes and bills against the organization named by the route', async () => {
      await expect(validateEnterpriseAuditAccess('viewer', 'organization-route')).resolves.toEqual({
        success: true,
        context: {
          organizationId: 'organization-route',
          orgMemberIds: ['viewer', 'member-2'],
        },
      })
      expect(dbChainMockFns.where).toHaveBeenNthCalledWith(1, {
        type: 'and',
        conditions: [
          { type: 'eq', left: schemaMock.member.userId, right: 'viewer' },
          { type: 'eq', left: schemaMock.member.organizationId, right: 'organization-route' },
        ],
      })
      expect(mockIsOrganizationBillingBlocked).toHaveBeenCalledWith('organization-route')
    })
  })

  describe('with billing disabled', () => {
    beforeEach(() => {
      setEnvFlags({ isBillingEnabled: false })
    })

    it('authorizes on the audit-logs entitlement without any subscription row', async () => {
      setEnvFlags({ isAuditLogsEnabled: true })
      queueTableRows(schemaMock.member, [{ organizationId: 'org-1', role: 'owner' }])
      queueTableRows(schemaMock.member, [{ userId: 'viewer' }, { userId: 'member-2' }])

      await expect(validateEnterpriseAuditAccess('viewer')).resolves.toEqual({
        success: true,
        context: { organizationId: 'org-1', orgMemberIds: ['viewer', 'member-2'] },
      })
      /**
       * The subscription lookup is what made audit logs unreachable
       * self-hosted; a billing-free deployment never has one to find.
       */
      expect(mockIsOrganizationBillingBlocked).not.toHaveBeenCalled()
    })

    it('refuses when the audit-logs entitlement is off', async () => {
      setEnvFlags({ isAuditLogsEnabled: false })
      queueTableRows(schemaMock.member, [{ organizationId: 'org-1', role: 'owner' }])

      const result = await validateEnterpriseAuditAccess('viewer')

      expect(result.success).toBe(false)
    })

    it('still requires an admin or owner role', async () => {
      setEnvFlags({ isAuditLogsEnabled: true })
      queueTableRows(schemaMock.member, [{ organizationId: 'org-1', role: 'member' }])

      const result = await validateEnterpriseAuditAccess('viewer')

      expect(result.success).toBe(false)
    })

    it('still requires organization membership', async () => {
      setEnvFlags({ isAuditLogsEnabled: true })
      queueTableRows(schemaMock.member, [])

      const result = await validateEnterpriseAuditAccess('viewer')

      expect(result.success).toBe(false)
    })
  })
})
