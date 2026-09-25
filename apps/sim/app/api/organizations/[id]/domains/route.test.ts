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
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: async () => null,
}))

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
    resetDbChainMock()
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'Admin', email: 'admin@acme.dev' },
      session: { id: 'session-1', token: 'tok-1' },
    })
    mockIsEnterprise.mockResolvedValue(true)
  })

  describe('GET', () => {
    it('403s for non-members', async () => {
      queueTableRows(member, [])
      const res = await GET(createMockRequest('GET'), routeContext)
      expect(res.status).toBe(403)
    })

    const PENDING = {
      id: 'd1',
      domain: 'acme.com',
      status: 'pending',
      verificationToken: 'secret',
      verifiedAt: null,
    }

    it('returns the pending TXT token to admins', async () => {
      queueTableRows(member, [{ role: 'admin' }])
      queueTableRows(ssoDomain, [PENDING])
      const res = await GET(createMockRequest('GET'), routeContext)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.domains[0]).toMatchObject({
        domain: 'acme.com',
        status: 'pending',
        txtRecordValue: 'sim-domain-verification=secret',
      })
    })

    it('redacts the pending TXT token for non-admin members', async () => {
      queueTableRows(member, [{ role: 'member' }])
      queueTableRows(ssoDomain, [PENDING])
      const res = await GET(createMockRequest('GET'), routeContext)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.domains[0]).toMatchObject({
        domain: 'acme.com',
        status: 'pending',
        txtRecordValue: null, // secret hidden from members
      })
    })

    it('returns an empty list (no domains/tokens) for non-Enterprise orgs', async () => {
      queueTableRows(member, [{ role: 'admin' }])
      mockIsEnterprise.mockResolvedValue(false)
      const res = await GET(createMockRequest('GET'), routeContext)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data).toEqual({ isEnterprise: false, domains: [] })
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

    it('409s when the domain is verified by another org', async () => {
      queueTableRows(member, [{ role: 'owner' }])
      queueTableRows(ssoDomain, [{ organizationId: 'other-org' }])
      const res = await POST(req({ domain: 'acme.com' }), routeContext)
      expect(res.status).toBe(409)
    })

    it('re-adds an existing pending domain idempotently without rotating its token', async () => {
      queueTableRows(member, [{ role: 'owner' }]) // membership
      queueTableRows(ssoDomain, []) // verified-elsewhere check → none
      queueTableRows(ssoDomain, [
        {
          id: 'd-existing',
          domain: 'acme.com',
          status: 'pending',
          verificationToken: 'tok-existing',
          verifiedAt: null,
        },
      ]) // org-domains read → already claimed, still pending
      const res = await POST(req({ domain: 'acme.com' }), routeContext)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.domain).toMatchObject({
        id: 'd-existing',
        status: 'pending',
        txtRecordValue: 'sim-domain-verification=tok-existing', // unchanged, not rotated
      })
      // No write occurred — the existing row is returned as-is.
      expect(dbChainMockFns.returning).not.toHaveBeenCalled()
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
