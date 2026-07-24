/**
 * @vitest-environment node
 */
import { member, ssoDomain } from '@sim/db/schema'
import {
  createMockRequest,
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockIsEnterprise, mockRecordAudit } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockIsEnterprise: vi.fn(),
  mockRecordAudit: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))

vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationOnEnterprisePlan: mockIsEnterprise,
}))

vi.mock('@/lib/core/config/env-flags', () => ({ isBillingEnabled: true }))

vi.mock('@sim/audit', () => ({
  recordAudit: mockRecordAudit,
  AuditAction: { ORGANIZATION_DOMAIN_ADDED: 'organization.domain.added' },
  AuditResourceType: { ORGANIZATION: 'organization' },
}))

import { GET, POST } from '@/app/api/organizations/[id]/domains/route'

const ORG_ID = 'org-1'
const routeContext = { params: Promise.resolve({ id: ORG_ID }) }

describe('org domains route', () => {
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
    it('401s when unauthenticated', async () => {
      mockGetSession.mockResolvedValue(null)
      const res = await GET(createMockRequest('GET'), routeContext)
      expect(res.status).toBe(401)
    })

    it('403s for non-members', async () => {
      queueTableRows(member, [])
      const res = await GET(createMockRequest('GET'), routeContext)
      expect(res.status).toBe(403)
    })

    it('returns mapped domains for members (token hidden on verified)', async () => {
      queueTableRows(member, [{ id: 'm1' }])
      queueTableRows(ssoDomain, [
        {
          id: 'd1',
          domain: 'acme.com',
          status: 'verified',
          verificationToken: 'secret',
          verifiedAt: new Date('2026-07-23T00:00:00.000Z'),
        },
      ])
      const res = await GET(createMockRequest('GET'), routeContext)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.domains[0]).toMatchObject({
        domain: 'acme.com',
        status: 'verified',
        txtRecordValue: null,
        challengeHost: '_sim-challenge.acme.com',
      })
    })
  })

  describe('POST', () => {
    function req(body: unknown) {
      return createMockRequest('POST', body)
    }

    it('403s for non-admins', async () => {
      queueTableRows(member, [{ role: 'member' }])
      const res = await POST(req({ domain: 'acme.com' }), routeContext)
      expect(res.status).toBe(403)
    })

    it('400s on an invalid domain', async () => {
      queueTableRows(member, [{ role: 'owner' }])
      const res = await POST(req({ domain: 'not a domain' }), routeContext)
      expect(res.status).toBe(400)
    })

    it('409s when the domain is verified by another org', async () => {
      queueTableRows(member, [{ role: 'owner' }])
      queueTableRows(ssoDomain, [{ organizationId: 'other-org' }])
      const res = await POST(req({ domain: 'acme.com' }), routeContext)
      expect(res.status).toBe(409)
    })

    it('claims a new domain as pending and records an audit event', async () => {
      queueTableRows(member, [{ role: 'owner' }]) // membership
      queueTableRows(ssoDomain, []) // verified-elsewhere check → none
      queueTableRows(ssoDomain, []) // org-domains read → none existing, under the cap
      // insert().returning()
      dbChainMockFns.returning.mockResolvedValueOnce([
        {
          id: 'd-new',
          domain: 'acme.com',
          status: 'pending',
          verificationToken: 'tok',
          verifiedAt: null,
        },
      ])
      const res = await POST(req({ domain: 'acme.com' }), routeContext)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.domain).toMatchObject({
        status: 'pending',
        txtRecordValue: 'sim-domain-verification=tok',
      })
      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'organization.domain.added' })
      )
    })

    it('stays idempotent when a concurrent claim wins the unique index race', async () => {
      queueTableRows(member, [{ role: 'owner' }]) // membership
      queueTableRows(ssoDomain, []) // verified-elsewhere check → none
      queueTableRows(ssoDomain, []) // org-domains read → none existing, under the cap
      // insert().returning() loses the race and hits sso_domain_org_domain_unique
      dbChainMockFns.returning.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), { code: '23505' })
      )
      queueTableRows(ssoDomain, [
        {
          id: 'd-winner',
          domain: 'acme.com',
          status: 'pending',
          verificationToken: 'tok-winner',
          verifiedAt: null,
        },
      ]) // re-read returns the row that landed
      const res = await POST(req({ domain: 'acme.com' }), routeContext)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.domain).toMatchObject({ id: 'd-winner', status: 'pending' })
    })
  })
})
