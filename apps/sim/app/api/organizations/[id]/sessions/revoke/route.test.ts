/**
 * @vitest-environment node
 */
import { member, organization, session as sessionTable } from '@sim/db/schema'
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

const { mockIsEnterprise, mockRecordAudit, mockSetVersion } = vi.hoisted(() => ({
  mockIsEnterprise: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockSetVersion: vi.fn(),
}))

vi.mock('@/lib/auth/security-policy', () => ({
  setSecurityPolicyVersion: mockSetVersion,
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationOnEnterprisePlan: mockIsEnterprise,
}))

vi.mock('@sim/audit', () => ({
  recordAudit: mockRecordAudit,
  AuditAction: { ORGANIZATION_SESSIONS_REVOKED: 'organization.sessions.revoked' },
  AuditResourceType: { ORGANIZATION: 'organization' },
}))

import { POST } from '@/app/api/organizations/[id]/sessions/revoke/route'

const mockGetSession = authMockFns.mockGetSession

const ORG_ID = 'org-1'
const CALLER_TOKEN = 'tok-caller'
const routeContext = { params: Promise.resolve({ id: ORG_ID }) }

interface MockCondition {
  type: string
  left?: unknown
  right?: unknown
  column?: unknown
  conditions?: MockCondition[]
}

/** Flattens the nested `and(...)` the route builds into a flat condition list. */
function flattenConditions(condition: MockCondition): MockCondition[] {
  if (condition.type !== 'and') return [condition]
  return (condition.conditions ?? []).flatMap(flattenConditions)
}

/**
 * The condition list passed to the session DELETE's `.where(...)`. Identified by
 * its `inArray` over `session.user_id` rather than by call position, since the
 * version-bump UPDATE issues its own `.where(...)` on the same shared spy.
 */
function deleteConditions(): MockCondition[] {
  expect(dbChainMockFns.delete).toHaveBeenCalledWith(sessionTable)
  const match = dbChainMockFns.where.mock.calls
    .map(([arg]) => flattenConditions(arg as MockCondition))
    .find((conditions) =>
      conditions.some(
        (condition) => condition.type === 'inArray' && condition.column === sessionTable.userId
      )
    )
  expect(match).toBeDefined()
  return match as MockCondition[]
}

function authenticateAs(overrides: Record<string, unknown> = {}) {
  mockGetSession.mockResolvedValue({
    user: { id: 'user-1', name: 'Admin', email: 'admin@acme.dev' },
    session: { token: CALLER_TOKEN, ...overrides },
  })
}

beforeAll(() => {
  setEnvFlags({ isBillingEnabled: true })
})

afterAll(resetEnvFlagsMock)

describe('org sessions revoke route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    authenticateAs()
    mockIsEnterprise.mockResolvedValue(true)
  })

  describe('authorization', () => {
    it('returns 401 when unauthenticated', async () => {
      mockGetSession.mockResolvedValue(null)
      const response = await POST(createMockRequest('POST'), routeContext)
      expect(response.status).toBe(401)
      expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    })

    it('returns 403 for non-members', async () => {
      queueTableRows(member, [])
      const response = await POST(createMockRequest('POST'), routeContext)
      expect(response.status).toBe(403)
      expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    })

    it('returns 403 for members without an admin role', async () => {
      queueTableRows(member, [{ role: 'member' }])
      const response = await POST(createMockRequest('POST'), routeContext)
      expect(response.status).toBe(403)
      expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    })

    it('returns 403 for non-enterprise organizations', async () => {
      queueTableRows(member, [{ role: 'owner' }])
      mockIsEnterprise.mockResolvedValue(false)
      const response = await POST(createMockRequest('POST'), routeContext)
      expect(response.status).toBe(403)
      expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    })

    it('returns 404 when the organization does not exist', async () => {
      queueTableRows(member, [{ role: 'owner' }])
      queueTableRows(organization, [])
      const response = await POST(createMockRequest('POST'), routeContext)
      expect(response.status).toBe(404)
      expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    })

    it('allows admins as well as owners', async () => {
      queueTableRows(member, [{ role: 'admin' }])
      queueTableRows(organization, [{ name: 'Acme' }])
      dbChainMockFns.returning
        .mockResolvedValueOnce([{ id: 's-1' }])
        .mockResolvedValueOnce([{ securityPolicyVersion: 5 }])
      const response = await POST(createMockRequest('POST'), routeContext)
      expect(response.status).toBe(200)
    })
  })

  describe('revocation', () => {
    beforeEach(() => {
      queueTableRows(member, [{ role: 'owner' }])
      queueTableRows(organization, [{ name: 'Acme' }])
    })

    it('reports the revoked count, bumps the version, and publishes it', async () => {
      dbChainMockFns.returning
        .mockResolvedValueOnce([{ id: 's-1' }, { id: 's-2' }])
        .mockResolvedValueOnce([{ securityPolicyVersion: 5 }])

      const response = await POST(createMockRequest('POST'), routeContext)

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ success: true, data: { revokedSessions: 2 } })
      expect(dbChainMockFns.set).toHaveBeenCalledWith(
        expect.objectContaining({ securityPolicyVersion: expect.anything() })
      )
      expect(mockSetVersion).toHaveBeenCalledWith(ORG_ID, 5)
      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'organization.sessions.revoked',
          resourceId: ORG_ID,
          metadata: { revokedSessions: 2 },
        })
      )
    })

    it("never deletes the caller's own session", async () => {
      dbChainMockFns.returning
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ securityPolicyVersion: 5 }])
      await POST(createMockRequest('POST'), routeContext)

      expect(deleteConditions()).toContainEqual(
        expect.objectContaining({ type: 'ne', right: CALLER_TOKEN })
      )
    })

    it('spares impersonation sessions', async () => {
      dbChainMockFns.returning
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ securityPolicyVersion: 5 }])
      await POST(createMockRequest('POST'), routeContext)

      expect(deleteConditions()).toContainEqual(
        expect.objectContaining({ type: 'isNull', column: sessionTable.impersonatedBy })
      )
    })

    it('scopes the delete to members of the organization', async () => {
      dbChainMockFns.returning
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ securityPolicyVersion: 5 }])
      await POST(createMockRequest('POST'), routeContext)

      expect(deleteConditions()).toContainEqual(
        expect.objectContaining({ type: 'inArray', column: sessionTable.userId })
      )
    })

    it("also spares the impersonator's own sessions when the caller is impersonating", async () => {
      authenticateAs({ impersonatedBy: 'platform-admin-1' })
      dbChainMockFns.returning
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ securityPolicyVersion: 5 }])

      await POST(createMockRequest('POST'), routeContext)

      expect(deleteConditions()).toContainEqual(
        expect.objectContaining({
          type: 'ne',
          left: sessionTable.userId,
          right: 'platform-admin-1',
        })
      )
    })

    it('adds no impersonator exclusion for an ordinary caller', async () => {
      dbChainMockFns.returning
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ securityPolicyVersion: 5 }])
      await POST(createMockRequest('POST'), routeContext)

      const userIdExclusions = deleteConditions().filter(
        (condition) => condition.type === 'ne' && condition.left === sessionTable.userId
      )
      expect(userIdExclusions).toHaveLength(0)
    })

    it('singularizes the audit description for a single session', async () => {
      dbChainMockFns.returning
        .mockResolvedValueOnce([{ id: 's-1' }])
        .mockResolvedValueOnce([{ securityPolicyVersion: 5 }])
      await POST(createMockRequest('POST'), routeContext)

      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Revoked 1 member session' })
      )
    })
  })
})
