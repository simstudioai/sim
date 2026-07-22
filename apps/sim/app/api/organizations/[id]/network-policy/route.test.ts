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

const { mockGetSession, mockIsEnterprise, mockGetTrustedClientIp, mockRecordAudit } = vi.hoisted(
  () => ({
    mockGetSession: vi.fn(),
    mockIsEnterprise: vi.fn(),
    mockGetTrustedClientIp: vi.fn(),
    mockRecordAudit: vi.fn(),
  })
)

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/auth/network-policy', () => ({
  getTrustedClientIp: mockGetTrustedClientIp,
  invalidateNetworkPolicyCache: vi.fn(),
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
    ORGANIZATION_NETWORK_POLICY_UPDATED: 'organization.network_policy.updated',
  },
  AuditResourceType: { ORGANIZATION: 'organization' },
}))

import { GET, PUT } from '@/app/api/organizations/[id]/network-policy/route'

const ORG_ID = 'org-1'
const routeContext = { params: Promise.resolve({ id: ORG_ID }) }

describe('network policy route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'Admin', email: 'admin@acme.dev' },
      session: { token: 'tok-1' },
    })
    mockIsEnterprise.mockResolvedValue(true)
    mockGetTrustedClientIp.mockReturnValue('10.0.5.5')
  })

  describe('GET', () => {
    it('returns 401 when unauthenticated', async () => {
      mockGetSession.mockResolvedValue(null)
      const response = await GET(createMockRequest('GET'), routeContext)
      expect(response.status).toBe(401)
    })

    it('returns the configured policy and caller IP for members', async () => {
      queueTableRows(member, [{ id: 'member-1' }])
      queueTableRows(organization, [
        { networkPolicySettings: { ipAllowlist: { enabled: true, cidrs: ['10.0.0.0/16'] } } },
      ])
      const response = await GET(createMockRequest('GET'), routeContext)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.data).toEqual({
        isEnterprise: true,
        configured: { enabled: true, cidrs: ['10.0.0.0/16'] },
        callerIp: '10.0.5.5',
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
        putRequest({ ipAllowlist: { enabled: true, cidrs: ['10.0.0.0/16'] } }),
        routeContext
      )
      expect(response.status).toBe(403)
    })

    it('rejects malformed CIDR entries at the contract boundary', async () => {
      queueTableRows(member, [{ role: 'owner' }])
      const response = await PUT(
        putRequest({ ipAllowlist: { enabled: true, cidrs: ['banana'] } }),
        routeContext
      )
      expect(response.status).toBe(400)
    })

    it('rejects a list that would lock the caller out', async () => {
      queueTableRows(member, [{ role: 'owner' }])
      mockGetTrustedClientIp.mockReturnValue('203.0.113.7')
      const response = await PUT(
        putRequest({ ipAllowlist: { enabled: true, cidrs: ['10.0.0.0/16'] } }),
        routeContext
      )
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toContain('203.0.113.7')
    })

    it('rejects enabling when the caller IP is unresolvable (fail-closed)', async () => {
      queueTableRows(member, [{ role: 'owner' }])
      mockGetTrustedClientIp.mockReturnValue(null)
      const response = await PUT(
        putRequest({ ipAllowlist: { enabled: true, cidrs: ['10.0.0.0/16'] } }),
        routeContext
      )
      expect(response.status).toBe(400)
    })

    it('saves an allowlist containing the caller IP and bumps the version', async () => {
      queueTableRows(member, [{ role: 'owner' }])
      queueTableRows(organization, [{ name: 'Acme' }])
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: ORG_ID }])

      const response = await PUT(
        putRequest({ ipAllowlist: { enabled: true, cidrs: ['10.0.0.0/16', '203.0.113.7'] } }),
        routeContext
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.data.configured).toEqual({
        enabled: true,
        cidrs: ['10.0.0.0/16', '203.0.113.7'],
      })
      expect(dbChainMockFns.set).toHaveBeenCalledWith(
        expect.objectContaining({ securityPolicyVersion: expect.anything() })
      )
      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'organization.network_policy.updated' })
      )
    })

    it('disabling skips the lockout guard entirely', async () => {
      queueTableRows(member, [{ role: 'owner' }])
      queueTableRows(organization, [{ name: 'Acme' }])
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: ORG_ID }])
      mockGetTrustedClientIp.mockReturnValue(null)

      const response = await PUT(
        putRequest({ ipAllowlist: { enabled: false, cidrs: [] } }),
        routeContext
      )
      expect(response.status).toBe(200)
    })
  })
})
