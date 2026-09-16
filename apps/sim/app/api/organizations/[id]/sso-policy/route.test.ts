/**
 * @vitest-environment node
 */
import { member, organization, ssoProvider } from '@sim/db/schema'
import {
  authMockFns,
  createMockRequest,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  setEnvFlags,
} from '@sim/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsEnterprise, mockRecordAudit, mockInvalidate } = vi.hoisted(() => ({
  mockIsEnterprise: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockInvalidate: vi.fn(),
}))

vi.mock('@/lib/auth/sso-policy', () => ({
  invalidateSsoPolicyCache: mockInvalidate,
}))

/**
 * These tests run with billing enabled, where `isOrganizationFeatureEntitled`
 * delegates straight to the plan check.
 */
vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationOnEnterprisePlan: mockIsEnterprise,
  isOrganizationFeatureEntitled: mockIsEnterprise,
}))

vi.mock('@sim/audit', () => ({
  recordAudit: mockRecordAudit,
  AuditAction: { ORGANIZATION_SSO_POLICY_UPDATED: 'organization.sso_policy.updated' },
  AuditResourceType: { ORGANIZATION: 'organization' },
}))

import { GET, PUT } from '@/app/api/organizations/[id]/sso-policy/route'

const mockGetSession = authMockFns.mockGetSession

const ORG_ID = 'org-1'
const routeContext = { params: Promise.resolve({ id: ORG_ID }) }

beforeAll(() => {
  setEnvFlags({ isBillingEnabled: true })
})

afterAll(resetEnvFlagsMock)

describe('sso policy route', () => {
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

    it('reports the requirement and whether a provider can satisfy it', async () => {
      queueTableRows(member, [{ id: 'member-1' }])
      queueTableRows(organization, [{ requireSso: true }])
      queueTableRows(ssoProvider, [{ id: 'provider-1' }])

      const response = await GET(createMockRequest('GET'), routeContext)
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        data: { requireSso: true, hasVerifiedProvider: true },
      })
    })
  })

  describe('PUT', () => {
    it('rejects non-admin members', async () => {
      queueTableRows(member, [{ role: 'member' }])
      const response = await PUT(createMockRequest('PUT', { requireSso: true }), routeContext)
      expect(response.status).toBe(403)
    })

    it('rejects organizations without the entitlement', async () => {
      queueTableRows(member, [{ role: 'owner' }])
      mockIsEnterprise.mockResolvedValue(false)
      const response = await PUT(createMockRequest('PUT', { requireSso: true }), routeContext)
      expect(response.status).toBe(403)
    })

    it('refuses to require SSO with no verified provider', async () => {
      queueTableRows(member, [{ role: 'owner' }])
      queueTableRows(organization, [{ name: 'Acme' }])
      queueTableRows(ssoProvider, [])

      const response = await PUT(createMockRequest('PUT', { requireSso: true }), routeContext)
      expect(response.status).toBe(400)
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })

    it('turns the requirement on, invalidates the cache, and records audit', async () => {
      queueTableRows(member, [{ role: 'admin' }])
      queueTableRows(organization, [{ name: 'Acme' }])
      queueTableRows(ssoProvider, [{ id: 'provider-1' }])
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: ORG_ID }])

      const response = await PUT(createMockRequest('PUT', { requireSso: true }), routeContext)
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({ data: { requireSso: true } })
      expect(dbChainMockFns.set).toHaveBeenCalledWith(expect.objectContaining({ requireSso: true }))
      expect(mockInvalidate).toHaveBeenCalledWith(ORG_ID)
      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'organization.sso_policy.updated' })
      )
    })

    it('turning the requirement off needs no provider', async () => {
      queueTableRows(member, [{ role: 'owner' }])
      queueTableRows(organization, [{ name: 'Acme' }])
      queueTableRows(ssoProvider, [])
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: ORG_ID }])

      const response = await PUT(createMockRequest('PUT', { requireSso: false }), routeContext)
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({ data: { requireSso: false } })
    })
  })
})
