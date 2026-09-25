import {
  auditMock,
  auditMockFns,
  authMockFns,
  createMockRequest,
  dbChainMockFns,
  hasMockCondition,
  permissionsMock,
  permissionsMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockSyncWorkspaceEnvCredentials,
  mockGetEffectiveWorkspacePermission,
  mockAssertMembershipNotScimManaged,
} = vi.hoisted(() => ({
  mockSyncWorkspaceEnvCredentials: vi.fn(),
  mockGetEffectiveWorkspacePermission: vi.fn(),
  mockAssertMembershipNotScimManaged: vi.fn(),
}))

vi.mock('@/ee/scim/lib/managed-membership', () => ({
  assertMembershipNotScimManaged: mockAssertMembershipNotScimManaged,
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(),
}))

vi.mock('@/lib/credentials/environment', () => ({
  syncWorkspaceEnvCredentials: mockSyncWorkspaceEnvCredentials,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  ...permissionsMock,
  getWorkspacePermissionsForViewer: vi.fn(),
  getEffectiveWorkspacePermission: mockGetEffectiveWorkspacePermission,
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: async (workspaceId: string) => ({
    workspaceId,
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
    billedAccountUserId: 'billing-user',
  }),
}))

vi.mock('@sim/platform-authz/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sim/platform-authz/workspace')>()),
  resolveEffectiveWorkspacePermission: async () =>
    (await permissionsMockFns.mockHasWorkspaceAdminAccess()) ? 'admin' : null,
}))

import { ForbiddenOperationError } from '@/lib/core/application'
import { getWorkspacePermissionsForViewer } from '@/lib/workspaces/permissions/utils'
import { GET, PATCH } from '@/app/api/workspaces/[id]/permissions/route'

const mockGetSession = authMockFns.mockGetSession

const WORKSPACE_ID = 'workspace-1'
const ADMIN_ID = 'user-admin'
const MEMBER_ID = 'user-member'
const OUTSIDER_ID = 'user-outsider'
/** Distinct from the session user so the billing guard is provable on its own. */
const BILLED_ID = 'user-billed'
/** Never a target by default, so the owner guard stays inert unless a test wants it. */
const OWNER_ID = 'user-owner'
const ORG_ID = 'org-1'

const routeContext = { params: Promise.resolve({ id: WORKSPACE_ID }) }

const permissionRow = (userId: string, permissionType: 'admin' | 'write' | 'read') => ({
  userId,
  permissionType,
  email: `${userId}@example.com`,
})

/**
 * Queues the reads a personal-workspace PATCH performs, in order: the workspace
 * row, then the permission rows twice — the unlocked pre-flight read that builds
 * the audit/membership snapshot, and the `FOR UPDATE` read inside the
 * transaction. The workspace-environment read is left unqueued so it resolves
 * empty and the credential sync is skipped.
 */
function queuePersonalWorkspace(
  existing: ReturnType<typeof permissionRow>[],
  billedAccountUserId: string = ADMIN_ID,
  locked: ReturnType<typeof permissionRow>[] = existing
) {
  const workspaceRow = { ownerId: OWNER_ID, billedAccountUserId, organizationId: null }
  queueTableRows(schemaMock.workspace, [workspaceRow])
  /** The in-transaction re-read of the same row, taken `FOR NO KEY UPDATE`. */
  permissionsMockFns.mockGetWorkspaceWithOwner.mockResolvedValue({
    id: WORKSPACE_ID,
    ...workspaceRow,
  })
  queueTableRows(schemaMock.permissions, existing)
  queueTableRows(schemaMock.permissions, locked)
}

/**
 * The organization branch runs an extra `member` read before the permissions
 * reads, so its result must be queued in that slot.
 */
function queueOrgWorkspace(
  orgAdminTargets: { userId: string }[],
  existing: ReturnType<typeof permissionRow>[],
  /** The in-transaction `FOR UPDATE` re-read, which carries roles to filter. */
  lockedMembers: { userId: string; role: string }[] = []
) {
  const workspaceRow = {
    ownerId: OWNER_ID,
    billedAccountUserId: BILLED_ID,
    organizationId: ORG_ID,
  }
  queueTableRows(schemaMock.workspace, [workspaceRow])
  permissionsMockFns.mockGetWorkspaceWithOwner.mockResolvedValue({
    id: WORKSPACE_ID,
    ...workspaceRow,
  })
  queueTableRows(schemaMock.member, orgAdminTargets)
  queueTableRows(schemaMock.member, lockedMembers)
  queueTableRows(schemaMock.permissions, existing)
  queueTableRows(schemaMock.permissions, existing)
}

describe('workspace permissions route', () => {
  beforeEach(() => {
    resetDbChainMock()

    mockGetSession.mockResolvedValue({
      session: { id: 'session-1' },
      user: { id: ADMIN_ID, name: 'Admin', email: 'a@b.co' },
    })
    permissionsMockFns.mockHasWorkspaceAdminAccess.mockResolvedValue(true)
    permissionsMockFns.mockGetUsersWithPermissions.mockResolvedValue([])
    mockSyncWorkspaceEnvCredentials.mockResolvedValue(undefined)
    mockGetEffectiveWorkspacePermission.mockResolvedValue('admin')
  })

  it('conceals an inaccessible member roster', async () => {
    permissionsMockFns.mockHasWorkspaceAdminAccess.mockResolvedValue(false)
    const response = await GET(createMockRequest('GET'), routeContext)
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: 'Workspace not found or access denied' })
    expect(getWorkspacePermissionsForViewer).not.toHaveBeenCalled()
  })

  describe('PATCH', () => {
    it('keeps the committed and audited result when credential reconciliation fails', async () => {
      queuePersonalWorkspace([permissionRow(ADMIN_ID, 'admin'), permissionRow(MEMBER_ID, 'read')])
      queueTableRows(schemaMock.workspaceEnvironment, [{ variables: { API_TOKEN: 'encrypted' } }])
      mockSyncWorkspaceEnvCredentials.mockRejectedValue(new Error('Credential storage unavailable'))

      const response = await PATCH(
        createMockRequest('PATCH', { updates: [{ userId: MEMBER_ID, permissions: 'write' }] }),
        routeContext
      )

      expect(response.status).toBe(200)
      expect(auditMockFns.mockRecordAudit).toHaveBeenCalledTimes(1)
      expect(mockSyncWorkspaceEnvCredentials).toHaveBeenCalledWith({
        workspaceId: WORKSPACE_ID,
        envKeys: ['API_TOKEN'],
        actingUserId: ADMIN_ID,
      })
      expect(auditMockFns.mockRecordAudit.mock.invocationCallOrder[0]).toBeLessThan(
        mockSyncWorkspaceEnvCredentials.mock.invocationCallOrder[0]
      )
    })

    /**
     * The row-queue mock returns whatever was queued regardless of predicate, so
     * a WHERE clause is only testable by inspecting the condition tree. Every
     * statement that selects permission rows by user — the pre-flight read, the
     * `FOR UPDATE` read, and the write — must be confined to this workspace;
     * losing `entityId` on the write would rewrite the target's role in EVERY
     * workspace they belong to, and losing it on a read would decide membership
     * from someone else's workspace.
     */
    it('confines every by-user permissions statement to this workspace', async () => {
      queuePersonalWorkspace([permissionRow(ADMIN_ID, 'admin'), permissionRow(MEMBER_ID, 'read')])

      await PATCH(
        createMockRequest('PATCH', { updates: [{ userId: MEMBER_ID, permissions: 'write' }] }),
        routeContext
      )

      const eqOn = (condition: unknown, column: unknown, value: unknown) =>
        hasMockCondition(
          condition,
          (node) => node.type === 'eq' && node.left === column && node.right === value
        )

      const byUserWheres = dbChainMockFns.where.mock.calls
        .map(([condition]) => condition)
        .filter((condition) =>
          hasMockCondition(
            condition,
            (node) => node.type === 'inArray' && node.column === schemaMock.permissions.userId
          )
        )

      expect(byUserWheres.length).toBeGreaterThan(0)
      for (const condition of byUserWheres) {
        expect(eqOn(condition, schemaMock.permissions.entityId, WORKSPACE_ID)).toBe(true)
        expect(eqOn(condition, schemaMock.permissions.entityType, 'workspace')).toBe(true)
      }
    })

    /**
     * Rows are locked in userId order so two concurrent batches over the same
     * members cannot acquire them in opposite orders and deadlock. The caller is
     * included: two admins editing each other would otherwise take
     * self-then-target in opposing orders.
     */
    it('locks the caller and every target in one ordered statement', async () => {
      queuePersonalWorkspace([permissionRow(ADMIN_ID, 'admin'), permissionRow(MEMBER_ID, 'read')])

      await PATCH(
        createMockRequest('PATCH', { updates: [{ userId: MEMBER_ID, permissions: 'write' }] }),
        routeContext
      )

      expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
      expect(dbChainMockFns.orderBy).toHaveBeenCalledWith(schemaMock.permissions.userId)

      const lockWhere = dbChainMockFns.where.mock.calls
        .map(([condition]) => condition)
        .find((condition) =>
          hasMockCondition(
            condition,
            (node) =>
              node.type === 'inArray' &&
              node.column === schemaMock.permissions.userId &&
              Array.isArray(node.values) &&
              node.values.includes(ADMIN_ID) &&
              node.values.includes(MEMBER_ID)
          )
        )

      expect(lockWhere).toBeDefined()
    })

    /**
     * The member passes the unlocked pre-flight read and is gone by the time the
     * `FOR UPDATE` read runs — the exact interleaving a concurrent removal
     * produces.
     */
    it('returns 409 when the member is removed concurrently', async () => {
      queuePersonalWorkspace(
        [permissionRow(ADMIN_ID, 'admin'), permissionRow(MEMBER_ID, 'read')],
        ADMIN_ID,
        [permissionRow(ADMIN_ID, 'admin')]
      )

      const response = await PATCH(
        createMockRequest('PATCH', { updates: [{ userId: MEMBER_ID, permissions: 'write' }] }),
        routeContext
      )

      expect(response.status).toBe(409)
      /** Routed through `withRouteHandler`, so the body carries a correlation id. */
      await expect(response.json()).resolves.toMatchObject({
        error: "This member's access just changed. Refresh and try again.",
        requestId: expect.any(String),
      })
      /** Detected before any write, so the whole batch rolls back. */
      expect(dbChainMockFns.set).not.toHaveBeenCalled()
      expect(dbChainMockFns.insert).not.toHaveBeenCalled()
      expect(permissionsMockFns.mockGetUsersWithPermissions).not.toHaveBeenCalled()
      expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
    })

    /**
     * `ownerId` and `billedAccountUserId` are read unlocked, and a workspace
     * admin can move both from other endpoints — removing the owner transfers
     * ownership, and the billed account is directly settable. Here the target
     * becomes the owner after the pre-flight read, so only the locked
     * re-evaluation can catch it.
     */
    it('aborts when the target becomes the owner mid-request', async () => {
      queuePersonalWorkspace([permissionRow(ADMIN_ID, 'admin'), permissionRow(MEMBER_ID, 'admin')])
      permissionsMockFns.mockGetWorkspaceWithOwner.mockResolvedValue({
        id: WORKSPACE_ID,
        ownerId: MEMBER_ID,
        billedAccountUserId: ADMIN_ID,
        organizationId: null,
      })

      const response = await PATCH(
        createMockRequest('PATCH', { updates: [{ userId: MEMBER_ID, permissions: 'read' }] }),
        routeContext
      )

      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toMatchObject({
        error: 'This workspace just changed. Refresh and try again.',
      })
      expect(dbChainMockFns.set).not.toHaveBeenCalled()
    })

    /**
     * The `lock_timeout` this route sets makes Postgres abort the transaction
     * under contention. Retries cover the transient case; when they run out the
     * caller must still get something actionable, not the driver error rendered
     * as "Internal server error".
     */
    it('answers contention that outlives the retries with a busy conflict', async () => {
      queuePersonalWorkspace([permissionRow(ADMIN_ID, 'admin'), permissionRow(MEMBER_ID, 'read')])
      dbChainMockFns.transaction.mockRejectedValue(
        Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' })
      )

      const response = await PATCH(
        createMockRequest('PATCH', { updates: [{ userId: MEMBER_ID, permissions: 'write' }] }),
        routeContext
      )

      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toMatchObject({
        error: 'This workspace is busy right now. Try again in a moment.',
      })
    })

    it('rejects the whole batch when any target is not already a member', async () => {
      queuePersonalWorkspace([permissionRow(ADMIN_ID, 'admin'), permissionRow(MEMBER_ID, 'read')])

      const response = await PATCH(
        createMockRequest('PATCH', {
          updates: [
            { userId: MEMBER_ID, permissions: 'write' },
            { userId: OUTSIDER_ID, permissions: 'read' },
          ],
        }),
        routeContext
      )

      expect(response.status).toBe(400)
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
      expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    })

    /**
     * A repeated userId used to slip past the self-demotion guard: it inspected
     * the first matching entry while the write loop applied every entry in order,
     * so a trailing `read` landed after a leading `admin` had satisfied the check.
     */
    it('rejects a batch that names the same user twice', async () => {
      queuePersonalWorkspace([permissionRow(ADMIN_ID, 'admin'), permissionRow(MEMBER_ID, 'read')])

      const response = await PATCH(
        createMockRequest('PATCH', {
          updates: [
            { userId: MEMBER_ID, permissions: 'admin' },
            { userId: MEMBER_ID, permissions: 'read' },
          ],
        }),
        routeContext
      )

      expect(response.status).toBe(400)
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })

    it('refuses to strip the acting admin of their own admin', async () => {
      queuePersonalWorkspace([permissionRow(ADMIN_ID, 'admin')])

      const response = await PATCH(
        createMockRequest('PATCH', { updates: [{ userId: ADMIN_ID, permissions: 'read' }] }),
        routeContext
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'Cannot remove your own admin permissions',
      })
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })

    /**
     * The owner holds an ordinary explicit admin row, so nothing but this guard
     * distinguishes them — an invited admin could otherwise demote the owner out
     * of their own workspace with no path back.
     */
    it('refuses to demote the workspace owner', async () => {
      queueTableRows(schemaMock.workspace, [
        { ownerId: MEMBER_ID, billedAccountUserId: BILLED_ID, organizationId: null },
      ])
      queueTableRows(schemaMock.permissions, [permissionRow(MEMBER_ID, 'admin')])

      const response = await PATCH(
        createMockRequest('PATCH', { updates: [{ userId: MEMBER_ID, permissions: 'read' }] }),
        routeContext
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'The workspace owner must retain admin permissions',
      })
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })

    it('aborts when the caller loses admin mid-request', async () => {
      queuePersonalWorkspace([permissionRow(ADMIN_ID, 'admin'), permissionRow(MEMBER_ID, 'read')])
      mockGetEffectiveWorkspacePermission.mockResolvedValue('write')

      const response = await PATCH(
        createMockRequest('PATCH', { updates: [{ userId: MEMBER_ID, permissions: 'admin' }] }),
        routeContext
      )

      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toMatchObject({
        error: 'Your workspace permissions changed. Refresh and try again.',
      })
      expect(dbChainMockFns.set).not.toHaveBeenCalled()
    })

    it('refuses to demote the workspace billing account', async () => {
      queuePersonalWorkspace([permissionRow(BILLED_ID, 'admin')], BILLED_ID)

      const response = await PATCH(
        createMockRequest('PATCH', { updates: [{ userId: BILLED_ID, permissions: 'read' }] }),
        routeContext
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'Workspace billing account must retain admin permissions',
      })
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })

    it('refuses a role change for a member the directory manages', async () => {
      queueOrgWorkspace([], [permissionRow(MEMBER_ID, 'read')])
      mockAssertMembershipNotScimManaged.mockRejectedValueOnce(
        new ForbiddenOperationError('SCIM_MANAGED_MEMBERSHIP', 'Managed by the directory')
      )

      const response = await PATCH(
        createMockRequest('PATCH', { updates: [{ userId: MEMBER_ID, permissions: 'write' }] }),
        routeContext
      )

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({ error: 'Managed by the directory' })
      expect(mockAssertMembershipNotScimManaged).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORG_ID, userId: MEMBER_ID })
      )
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })

    it('refuses to change the role of an organization admin', async () => {
      queueOrgWorkspace([{ userId: MEMBER_ID }], [permissionRow(MEMBER_ID, 'admin')])

      const response = await PATCH(
        createMockRequest('PATCH', { updates: [{ userId: MEMBER_ID, permissions: 'read' }] }),
        routeContext
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'Organization admins are workspace admins and their role cannot be changed',
      })
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })
  })
})
