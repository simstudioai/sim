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

const { mockGetSession, mockIsEnterprise, mockRecordAudit, mockCheckDomainTxtRecord } = vi.hoisted(
  () => ({
    mockGetSession: vi.fn(),
    mockIsEnterprise: vi.fn(),
    mockRecordAudit: vi.fn(),
    mockCheckDomainTxtRecord: vi.fn(),
  })
)

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))

vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationOnEnterprisePlan: mockIsEnterprise,
}))

vi.mock('@/lib/core/config/env-flags', () => ({ isBillingEnabled: true }))

vi.mock('@sim/audit', () => ({
  recordAudit: mockRecordAudit,
  AuditAction: { ORGANIZATION_DOMAIN_VERIFIED: 'organization.domain.verified' },
  AuditResourceType: { ORGANIZATION: 'organization' },
}))

vi.mock('@/lib/auth/sso/domain-verification', () => ({
  checkDomainTxtRecord: mockCheckDomainTxtRecord,
  toDomainResponse: (row: { id: string; status: string }) => ({ id: row.id, status: row.status }),
}))

import { POST } from '@/app/api/organizations/[id]/domains/[domainId]/verify/route'

const ORG_ID = 'org-1'
const DOMAIN_ID = 'd1'
const routeContext = { params: Promise.resolve({ id: ORG_ID, domainId: DOMAIN_ID }) }
const PENDING_ROW = {
  id: DOMAIN_ID,
  domain: 'acme.com',
  status: 'pending',
  verificationToken: 'tok',
  verifiedAt: null,
}

/** Queues the membership + pending-row lookups shared by the happy path. */
function queueAdminWithPendingRow() {
  queueTableRows(member, [{ role: 'owner' }])
  queueTableRows(ssoDomain, [PENDING_ROW]) // row lookup
}

describe('verify org domain route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'Admin', email: 'admin@acme.dev' },
    })
    mockIsEnterprise.mockResolvedValue(true)
    mockCheckDomainTxtRecord.mockResolvedValue('present')
  })

  it('422s when the TXT record is not found', async () => {
    queueAdminWithPendingRow()
    mockCheckDomainTxtRecord.mockResolvedValue('absent')
    const res = await POST(createMockRequest('POST'), routeContext)
    expect(res.status).toBe(422)
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  /**
   * A failed lookup says nothing about the admin's DNS, so it must not be reported
   * as a missing record — that sends them hunting through their zone for our fault.
   */
  it('503s (not 422) when the DNS lookup itself could not complete', async () => {
    queueAdminWithPendingRow()
    mockCheckDomainTxtRecord.mockResolvedValue('unavailable')
    const res = await POST(createMockRequest('POST'), routeContext)
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("couldn't complete the DNS lookup"),
    })
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('verifies the domain and records an audit event', async () => {
    queueAdminWithPendingRow()
    queueTableRows(ssoDomain, []) // verified-elsewhere check → none
    dbChainMockFns.returning.mockResolvedValueOnce([{ ...PENDING_ROW, status: 'verified' }])
    const res = await POST(createMockRequest('POST'), routeContext)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.domain).toMatchObject({ status: 'verified' })
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'organization.domain.verified' })
    )
  })

  it('is idempotent when a concurrent same-org request already verified the row', async () => {
    queueAdminWithPendingRow()
    queueTableRows(ssoDomain, []) // verified-elsewhere check → none
    dbChainMockFns.returning.mockResolvedValueOnce([]) // our conditional update lost the race
    queueTableRows(ssoDomain, [{ ...PENDING_ROW, status: 'verified' }]) // re-read: now verified
    const res = await POST(createMockRequest('POST'), routeContext)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.domain).toMatchObject({ status: 'verified' })
    expect(mockRecordAudit).not.toHaveBeenCalled() // the winning request recorded it
  })

  it('409s when the row changed (deleted/re-tokenized) during the DNS lookup', async () => {
    queueAdminWithPendingRow()
    queueTableRows(ssoDomain, []) // verified-elsewhere check → none
    dbChainMockFns.returning.mockResolvedValueOnce([]) // conditional update matched no row
    const res = await POST(createMockRequest('POST'), routeContext)
    expect(res.status).toBe(409)
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  /**
   * Deleting a verified domain revokes `domainVerified` on the providers it covered.
   * Re-verifying has to restore it, or the provider stays untrusted — and since that
   * flag gates sign-in rather than only linking, the org would sit in a silent SSO
   * outage until an admin happened to re-save the SSO config.
   */
  it('restores SSO domain trust for providers on the verified domain', async () => {
    queueAdminWithPendingRow()
    queueTableRows(ssoDomain, []) // verified-elsewhere check → none
    dbChainMockFns.returning.mockResolvedValueOnce([{ ...PENDING_ROW, status: 'verified' }])
    const res = await POST(createMockRequest('POST'), routeContext)
    expect(res.status).toBe(200)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ domainVerified: true })
  })

  /**
   * Mirrors the revocation's wildcard-tolerant comparison: a provider grandfathered
   * as `*.acme.com` must be re-trusted by a proof row holding `acme.com`.
   */
  it('matches the provider domain wildcard-tolerantly, as the revocation does', async () => {
    queueAdminWithPendingRow()
    queueTableRows(ssoDomain, [])
    dbChainMockFns.returning.mockResolvedValueOnce([{ ...PENDING_ROW, status: 'verified' }])
    await POST(createMockRequest('POST'), routeContext)
    const grantWhere = dbChainMockFns.where.mock.calls.find(([condition]) =>
      JSON.stringify(condition ?? '').includes('regexp_replace')
    )
    expect(grantWhere).toBeDefined()
  })

  /**
   * A provider can hold a verified domain while its own trust flag is off, after
   * an update whose grant was refused reverted the config and cleared it. Re-running
   * verification is the obvious recovery, so an already-verified domain must still
   * re-grant instead of returning success having done nothing.
   */
  it('re-grants trust when the domain is already verified', async () => {
    queueAdminWithPendingRow()
    queueTableRows(ssoDomain, [])
    dbChainMockFns.returning.mockResolvedValueOnce([]) // conditional update matched nothing
    queueTableRows(ssoDomain, [{ ...PENDING_ROW, status: 'verified' }]) // re-read: verified
    const res = await POST(createMockRequest('POST'), routeContext)
    expect(res.status).toBe(200)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ domainVerified: true })
  })

  it('does not grant trust when the challenge is genuinely stale', async () => {
    queueAdminWithPendingRow()
    queueTableRows(ssoDomain, [])
    dbChainMockFns.returning.mockResolvedValueOnce([]) // conditional update matched nothing
    queueTableRows(ssoDomain, []) // re-read: row deleted or re-tokenized
    const res = await POST(createMockRequest('POST'), routeContext)
    expect(res.status).toBe(409)
    expect(dbChainMockFns.set).not.toHaveBeenCalledWith({ domainVerified: true })
  })

  it('409s (not 500) when a concurrent cross-org verification wins the unique index', async () => {
    queueAdminWithPendingRow()
    queueTableRows(ssoDomain, []) // verified-elsewhere check → none at read time
    dbChainMockFns.returning.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key'), { code: '23505' })
    )
    const res = await POST(createMockRequest('POST'), routeContext)
    expect(res.status).toBe(409)
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })
})
