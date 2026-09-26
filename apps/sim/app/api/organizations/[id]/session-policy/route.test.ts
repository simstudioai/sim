import { member, organization } from '@sim/db/schema'
import {
  authMockFns,
  createMockRequest,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  setEnvFlags,
} from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import { permissionGroupsResolveMock } from '@sim/testing/mocks/permission-groups-resolve.mock'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mockEagerClamp = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/session-policy', () => ({
  eagerClampOrgSessions: mockEagerClamp,
  invalidateSessionPolicyCache: vi.fn(),
}))

vi.mock('@/lib/auth/security-policy', () => ({
  invalidateSecurityPolicyVersionCache: vi.fn(),
}))

vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)

vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)

vi.mock('@sim/audit', () => auditMock)

import { GET, PUT } from '@/app/api/organizations/[id]/session-policy/route'

const mockGetSession = authMockFns.mockGetSession
const mockRecordAudit = auditMockFns.mockRecordAudit
const mockIsEnterprise = billingSubscriptionMockFns.mockIsOrganizationOnEnterprisePlan

/**
 * These tests run with billing enabled, where `isOrganizationFeatureEntitled`
 * delegates straight to the plan check — so both names resolve to the same
 * mock and `mockIsEnterprise` keeps steering the gate.
 */
billingSubscriptionMockFns.mockIsOrganizationFeatureEntitled.mockImplementation(
  (...args: unknown[]) => mockIsEnterprise(...args)
)

const ORG_ID = 'org-1'
const routeContext = createRouteContext({ id: ORG_ID })

beforeAll(() => {
  setEnvFlags({ isBillingEnabled: true })
})

afterAll(resetEnvFlagsMock)

describe('session policy route', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'Admin', email: 'admin@acme.dev' },
      session: { id: 'session-1', token: 'tok-1' },
    })
    mockIsEnterprise.mockResolvedValue(true)
  })

  describe('GET', () => {
    it('returns 403 for non-members', async () => {
      queueTableRows(member, [])
      const response = await GET(createMockRequest('GET'), routeContext)
      expect(response.status).toBe(403)
    })
  })

  describe('PUT', () => {
    function putRequest(body: unknown) {
      return createMockRequest('PUT', body)
    }

    it('rejects non-admin members', async () => {
      queueTableRows(member, [{ role: 'member' }])
      const response = await PUT(
        putRequest({ maxSessionHours: 72, idleTimeoutHours: null }),
        routeContext
      )
      expect(response.status).toBe(403)
    })

    it('rejects an idle timeout below the cookie-cache window', async () => {
      queueTableRows(member, [{ role: 'admin' }])
      const response = await PUT(
        putRequest({ maxSessionHours: null, idleTimeoutHours: 5 }),
        routeContext
      )
      expect(response.status).toBe(400)
    })

    it('rejects non-enterprise organizations', async () => {
      queueTableRows(member, [{ role: 'owner' }])
      mockIsEnterprise.mockResolvedValue(false)
      const response = await PUT(
        putRequest({ maxSessionHours: 72, idleTimeoutHours: null }),
        routeContext
      )
      expect(response.status).toBe(403)
    })

    it('saves the policy, eagerly clamps sessions, and bumps the version', async () => {
      queueTableRows(member, [{ role: 'owner' }])
      queueTableRows(organization, [{ name: 'Acme' }])
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: ORG_ID }])

      const response = await PUT(
        putRequest({ maxSessionHours: 72, idleTimeoutHours: 48 }),
        routeContext
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.data.configured).toEqual({ maxSessionHours: 72, idleTimeoutHours: 48 })
      expect(mockEagerClamp).toHaveBeenCalledWith(
        ORG_ID,
        { maxSessionHours: 72, idleTimeoutHours: 48 },
        expect.anything()
      )
      // The version bump rides the settings UPDATE (single round trip).
      expect(dbChainMockFns.set).toHaveBeenCalledWith(
        expect.objectContaining({ securityPolicyVersion: expect.anything() })
      )
      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'organization.session_policy.updated' })
      )
    })
  })
})
