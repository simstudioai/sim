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
    mockCheckDomainTxtRecord.mockResolvedValue(true)
  })

  it('422s when the TXT record is not found', async () => {
    queueAdminWithPendingRow()
    mockCheckDomainTxtRecord.mockResolvedValue(false)
    const res = await POST(createMockRequest('POST'), routeContext)
    expect(res.status).toBe(422)
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

  it('409s when the row changed (deleted/re-tokenized) during the DNS lookup', async () => {
    queueAdminWithPendingRow()
    queueTableRows(ssoDomain, []) // verified-elsewhere check → none
    dbChainMockFns.returning.mockResolvedValueOnce([]) // conditional update matched no row
    const res = await POST(createMockRequest('POST'), routeContext)
    expect(res.status).toBe(409)
    expect(mockRecordAudit).not.toHaveBeenCalled()
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
