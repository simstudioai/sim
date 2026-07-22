/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDbState,
  mockGetSession,
  mockIsEnterprise,
  mockBumpVersion,
  mockRecordAudit,
  mockExecute,
  mockUpdateReturning,
} = vi.hoisted(() => ({
  mockDbState: { selectResults: [] as unknown[][] },
  mockGetSession: vi.fn(),
  mockIsEnterprise: vi.fn(),
  mockBumpVersion: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockExecute: vi.fn(),
  mockUpdateReturning: vi.fn(),
}))

function createSelectChain() {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  }
  chain.from.mockReturnValue(chain)
  chain.where.mockReturnValue(chain)
  chain.limit.mockImplementation(() => Promise.resolve(mockDbState.selectResults.shift() ?? []))
  return chain
}

function createUpdateChain() {
  const chain = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
  }
  chain.set.mockReturnValue(chain)
  chain.where.mockReturnValue(chain)
  chain.returning.mockImplementation(() => Promise.resolve(mockUpdateReturning()))
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(() => createSelectChain()),
    update: vi.fn(() => createUpdateChain()),
    execute: mockExecute,
  },
}))

vi.mock('@sim/db/schema', () => ({
  member: {
    id: 'member.id',
    organizationId: 'member.organizationId',
    userId: 'member.userId',
    role: 'member.role',
  },
  organization: {
    id: 'organization.id',
    name: 'organization.name',
    sessionPolicySettings: 'organization.sessionPolicySettings',
  },
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/auth/session-policy', () => ({
  bumpSecurityPolicyVersion: mockBumpVersion,
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
    mockDbState.selectResults = []
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'Admin', email: 'admin@acme.dev' },
      session: { token: 'tok-1' },
    })
    mockIsEnterprise.mockResolvedValue(true)
    mockExecute.mockResolvedValue(undefined)
  })

  describe('GET', () => {
    it('returns 401 when unauthenticated', async () => {
      mockGetSession.mockResolvedValue(null)
      const response = await GET(createMockRequest('GET'), routeContext)
      expect(response.status).toBe(401)
    })

    it('returns 403 for non-members', async () => {
      mockDbState.selectResults = [[]]
      const response = await GET(createMockRequest('GET'), routeContext)
      expect(response.status).toBe(403)
    })

    it('returns the configured policy for members', async () => {
      mockDbState.selectResults = [
        [{ id: 'member-1' }],
        [{ sessionPolicySettings: { maxSessionHours: 72, idleTimeoutHours: null } }],
      ]
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
      mockDbState.selectResults = [[{ role: 'member' }]]
      const response = await PUT(putRequest({ maxSessionHours: 72 }), routeContext)
      expect(response.status).toBe(403)
    })

    it('rejects an idle timeout below the cookie-cache window', async () => {
      mockDbState.selectResults = [[{ role: 'admin' }]]
      const response = await PUT(putRequest({ idleTimeoutHours: 5 }), routeContext)
      expect(response.status).toBe(400)
    })

    it('rejects non-enterprise organizations', async () => {
      mockDbState.selectResults = [[{ role: 'owner' }]]
      mockIsEnterprise.mockResolvedValue(false)
      const response = await PUT(putRequest({ maxSessionHours: 72 }), routeContext)
      expect(response.status).toBe(403)
    })

    it('saves the policy, eagerly clamps sessions, and bumps the version', async () => {
      mockDbState.selectResults = [
        [{ role: 'owner' }],
        [{ name: 'Acme', sessionPolicySettings: null }],
      ]
      mockUpdateReturning.mockReturnValue([
        { sessionPolicySettings: { maxSessionHours: 72, idleTimeoutHours: 48 } },
      ])

      const response = await PUT(
        putRequest({ maxSessionHours: 72, idleTimeoutHours: 48 }),
        routeContext
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.data.configured).toEqual({ maxSessionHours: 72, idleTimeoutHours: 48 })
      expect(mockExecute).toHaveBeenCalledTimes(1)
      expect(mockBumpVersion).toHaveBeenCalledWith(ORG_ID)
      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'organization.session_policy.updated' })
      )
    })

    it('skips the eager clamp when both policy fields are cleared', async () => {
      mockDbState.selectResults = [
        [{ role: 'owner' }],
        [{ name: 'Acme', sessionPolicySettings: { maxSessionHours: 72 } }],
      ]
      mockUpdateReturning.mockReturnValue([
        { sessionPolicySettings: { maxSessionHours: null, idleTimeoutHours: null } },
      ])

      const response = await PUT(
        putRequest({ maxSessionHours: null, idleTimeoutHours: null }),
        routeContext
      )
      expect(response.status).toBe(200)
      expect(mockExecute).not.toHaveBeenCalled()
      expect(mockBumpVersion).toHaveBeenCalledWith(ORG_ID)
    })
  })
})
