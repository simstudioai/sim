/**
 * @vitest-environment node
 */
import { member, organization } from '@sim/db/schema'
import {
  createMockRequest,
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockIsEnterprise, mockEagerClamp, mockRecordAudit } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockIsEnterprise: vi.fn(),
  mockEagerClamp: vi.fn(),
  mockRecordAudit: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/auth/session-policy', () => ({
  eagerClampOrgSessions: mockEagerClamp,
  invalidateSessionPolicyCache: vi.fn(),
}))

vi.mock('@/lib/auth/security-policy', () => ({
  invalidateSecurityPolicyVersionCache: vi.fn(),
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationOnEnterprisePlan: mockIsEnterprise,
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  isBillingEnabled: true,
}))

vi.mock('@sim/audit', () => ({
  recordAudit: mockRecordAudit,
  AuditAction: {
    ORGANIZATION_SESSION_POLICY_UPDATED: 'organization.session_policy.updated',
  },
  AuditResourceType: { ORGANIZATION: 'organization' },
}))

import { GET, PUT } from '@/app/api/organizations/[id]/session-policy/route'

const ORG_ID = 'org-1'
const routeContext = { params: Promise.resolve({ id: ORG_ID }) }

describe('session policy route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'Admin', email: 'admin@acme.dev' },
      session: { token: 'tok-1' },
    })
    mockIsEnterprise.mockResolvedValue(true)
  })

  describe('GET', () => {
    it('returns 401 when unauthenticated', async () => {
      mockGetSession.mockResolvedValue(null)
      const response = await GET(createMockRequest('GET'), routeContext)
      expect(response.status).toBe(401)
    })

    it('returns 403 for non-members', async () => {
      queueTableRows(member, [])
      const response = await GET(createMockRequest('GET'), routeContext)
      expect(response.status).toBe(403)
    })

    it('returns the configured policy for members', async () => {
      queueTableRows(member, [{ id: 'member-1' }])
      queueTableRows(organization, [
        { sessionPolicySettings: { maxSessionHours: 72, idleTimeoutHours: null } },
      ])
      const response = await GET(createMockRequest('GET'), routeContext)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.data).toEqual({
        isEnterprise: true,
        configured: { maxSessionHours: 72, idleTimeoutHours: null },
      })
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

    it('clearing both fields still saves and delegates the no-op to the clamp', async () => {
      queueTableRows(member, [{ role: 'owner' }])
      queueTableRows(organization, [{ name: 'Acme' }])
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: ORG_ID }])

      const response = await PUT(
        putRequest({ maxSessionHours: null, idleTimeoutHours: null }),
        routeContext
      )
      expect(response.status).toBe(200)
      expect(mockEagerClamp).toHaveBeenCalledWith(
        ORG_ID,
        { maxSessionHours: null, idleTimeoutHours: null },
        expect.anything()
      )
    })
  })
})
