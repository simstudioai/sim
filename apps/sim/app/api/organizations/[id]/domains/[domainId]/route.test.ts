/**
 * @vitest-environment node
 */
import { member } from '@sim/db/schema'
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
  AuditAction: { ORGANIZATION_DOMAIN_REMOVED: 'organization.domain.removed' },
  AuditResourceType: { ORGANIZATION: 'organization' },
}))

import { DELETE } from '@/app/api/organizations/[id]/domains/[domainId]/route'

const routeContext = { params: Promise.resolve({ id: 'org-1', domainId: 'd1' }) }

describe('remove org domain route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'Admin', email: 'admin@acme.dev' },
    })
    mockIsEnterprise.mockResolvedValue(true)
  })

  it('401s when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await DELETE(createMockRequest('DELETE'), routeContext)
    expect(res.status).toBe(401)
  })

  it('403s for non-admins', async () => {
    queueTableRows(member, [{ role: 'member' }])
    const res = await DELETE(createMockRequest('DELETE'), routeContext)
    expect(res.status).toBe(403)
  })

  it('403s for non-Enterprise orgs', async () => {
    queueTableRows(member, [{ role: 'owner' }])
    mockIsEnterprise.mockResolvedValue(false)
    const res = await DELETE(createMockRequest('DELETE'), routeContext)
    expect(res.status).toBe(403)
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('404s when the domain does not exist', async () => {
    queueTableRows(member, [{ role: 'owner' }])
    dbChainMockFns.returning.mockResolvedValueOnce([]) // delete matched nothing
    const res = await DELETE(createMockRequest('DELETE'), routeContext)
    expect(res.status).toBe(404)
  })

  it('removes the domain and records an audit event', async () => {
    queueTableRows(member, [{ role: 'owner' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ domain: 'acme.com' }])
    const res = await DELETE(createMockRequest('DELETE'), routeContext)
    expect(res.status).toBe(200)
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'organization.domain.removed' })
    )
  })
})
