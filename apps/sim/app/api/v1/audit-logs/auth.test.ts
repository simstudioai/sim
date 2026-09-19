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

const { mockIsOrganizationBillingBlocked, mockCheckOrganizationPersonalKeyRefusal } = vi.hoisted(
  () => ({
    mockIsOrganizationBillingBlocked: vi.fn(),
    mockCheckOrganizationPersonalKeyRefusal: vi.fn(),
  })
)

vi.mock('@/lib/billing/core/access', () => ({
  isOrganizationBillingBlocked: mockIsOrganizationBillingBlocked,
}))

vi.mock('@/app/api/v1/middleware', () => ({
  capabilityGovernedUserId: (rateLimit: { keyType?: string; userId?: string }) =>
    rateLimit.keyType === 'personal' ? (rateLimit.userId ?? null) : null,
  checkOrganizationPersonalKeyRefusal: mockCheckOrganizationPersonalKeyRefusal,
}))

import {
  validateEnterpriseAuditAccess,
  validateV1EnterpriseAuditAccess,
} from '@/app/api/v1/audit-logs/auth'

describe('enterprise audit access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsOrganizationBillingBlocked.mockResolvedValue(false)
    mockCheckOrganizationPersonalKeyRefusal.mockResolvedValue(null)
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

    it('names the requested organization when target membership is missing', async () => {
      setEnvFlags({ isAuditLogsEnabled: true })
      queueTableRows(schemaMock.member, [])

      const result = await validateEnterpriseAuditAccess('viewer', 'organization-route')

      if (result.success) throw new Error('Expected organization membership to be rejected')
      expect(result.response.status).toBe(403)
      await expect(result.response.json()).resolves.toEqual({
        error: 'Not a member of the requested organization',
      })
    })
  })

  describe('v1 API-key access', () => {
    const personalKey = {
      allowed: true,
      remaining: 1,
      limit: 1,
      resetAt: new Date(),
      userId: 'viewer',
      keyType: 'personal' as const,
    }

    beforeEach(() => {
      setEnvFlags({ isBillingEnabled: false, isAuditLogsEnabled: true })
    })

    it('refuses a workspace key before resolving its creator as the subject', async () => {
      const result = await validateV1EnterpriseAuditAccess({
        ...personalKey,
        keyType: 'workspace',
        workspaceId: 'workspace-a',
      })

      if (result.success) throw new Error('Expected the workspace key to be refused')
      expect(result.response.status).toBe(403)
      await expect(result.response.json()).resolves.toEqual({
        error: 'Audit logs require a personal API key',
      })
      expect(dbChainMockFns.where).not.toHaveBeenCalled()
      expect(mockCheckOrganizationPersonalKeyRefusal).not.toHaveBeenCalled()
    })

    it('authorizes a personal key held by an organization admin', async () => {
      queueTableRows(schemaMock.member, [{ organizationId: 'org-1', role: 'admin' }])
      queueTableRows(schemaMock.member, [{ userId: 'viewer' }])

      await expect(validateV1EnterpriseAuditAccess(personalKey)).resolves.toEqual({
        success: true,
        userId: 'viewer',
        context: { organizationId: 'org-1', orgMemberIds: ['viewer'] },
      })
      expect(mockCheckOrganizationPersonalKeyRefusal).toHaveBeenCalledWith(personalKey)
    })

    it('refuses a personal key its permission group withholds', async () => {
      queueTableRows(schemaMock.member, [{ organizationId: 'org-1', role: 'admin' }])
      queueTableRows(schemaMock.member, [{ userId: 'viewer' }])
      const refusal = new Response(null, { status: 403 })
      mockCheckOrganizationPersonalKeyRefusal.mockResolvedValue(refusal)

      const result = await validateV1EnterpriseAuditAccess(personalKey)

      if (result.success) throw new Error('Expected the withheld personal key to be refused')
      expect(result.response).toBe(refusal)
    })

    it('answers a non-admin with the role refusal, not the group configuration', async () => {
      queueTableRows(schemaMock.member, [{ organizationId: 'org-1', role: 'member' }])
      mockCheckOrganizationPersonalKeyRefusal.mockResolvedValue(new Response(null, { status: 403 }))

      const result = await validateV1EnterpriseAuditAccess(personalKey)

      if (result.success) throw new Error('Expected the non-admin to be refused')
      await expect(result.response.json()).resolves.toEqual({
        error: 'Organization admin or owner role required',
      })
      expect(mockCheckOrganizationPersonalKeyRefusal).not.toHaveBeenCalled()
    })
  })
})
