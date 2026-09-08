/**
 * @vitest-environment node
 */
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

import { ForbiddenOperationError } from '@/lib/core/application'
import { PATCH } from '@/app/api/workspaces/[id]/permissions/route'

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
    vi.clearAllMocks()
    resetDbChainMock()

    mockGetSession.mockResolvedValue({ user: { id: ADMIN_ID, name: 'Admin', email: 'a@b.co' } })
    permissionsMockFns.mockHasWorkspaceAdminAccess.mockResolvedValue(true)
    permissionsMockFns.mockGetUsersWithPermissions.mockResolvedValue([])
    mockSyncWorkspaceEnvCredentials.mockResolvedValue(undefined)
    mockGetEffectiveWorkspacePermission.mockResolvedValue('admin')
  })

  describe('PATCH', () => {
    it('updates permissions for an existing member', async () => {
      queuePersonalWorkspace([permissionRow(ADMIN_ID, 'admin'), permissionRow(MEMBER_ID, 'read')])
      dbChainMockFns.returning.mockResolvedValue([{ id: 'perm-1' }])

      const response = await PATCH(
        createMockRequest('PATCH', { updates: [{ userId: MEMBER_ID, permissions: 'write' }] }),
        routeContext
      )

      expect(response.status).toBe(200)
      expect(dbChainMockFns.update).toHaveBeenCalledWith(schemaMock.permissions)
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
     * The row is updated in place rather than deleted and re-inserted, so
     * `permissions.createdAt` — surfaced to the UI as the member's joined date —
     * survives a role change. A `createdAt` or `id` in the SET payload would
     * mean the old delete+insert shape came back.
     */
    it('preserves the joined date by updating the row in place', async () => {
      queuePersonalWorkspace([permissionRow(ADMIN_ID, 'admin'), permissionRow(MEMBER_ID, 'read')])
      dbChainMockFns.returning.mockResolvedValue([{ id: 'perm-1' }])

      await PATCH(
        createMockRequest('PATCH', { updates: [{ userId: MEMBER_ID, permissions: 'write' }] }),
        routeContext
      )

      expect(dbChainMockFns.insert).not.toHaveBeenCalled()
      expect(dbChainMockFns.delete).not.toHaveBeenCalled()
      expect(dbChainMockFns.set).toHaveBeenCalledWith({
        permissionType: 'write',
        updatedAt: expect.any(Date),
      })
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
     * The target is a plain member on the unlocked pre-flight read and an
     * organization admin by the time the `FOR UPDATE` read runs, so only the
     * locked re-evaluation can refuse it. Without the target's `member` row in
     * the lock set this commits, leaving an explicit `read` row underneath an
     * inherited admin — which is what they silently drop to on leaving the org.
     */
    it('aborts when the target becomes an organization admin mid-request', async () => {
      queueOrgWorkspace(
        [],
        [permissionRow(MEMBER_ID, 'read')],
        [{ userId: MEMBER_ID, role: 'admin' }]
      )

      const response = await PATCH(
        createMockRequest('PATCH', { updates: [{ userId: MEMBER_ID, permissions: 'write' }] }),
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

    it('aborts when the workspace leaves its organization mid-request', async () => {
      queuePersonalWorkspace([permissionRow(ADMIN_ID, 'admin'), permissionRow(MEMBER_ID, 'read')])
      permissionsMockFns.mockGetWorkspaceWithOwner.mockResolvedValue({
        id: WORKSPACE_ID,
        ownerId: OWNER_ID,
        billedAccountUserId: ADMIN_ID,
        organizationId: ORG_ID,
      })

      const response = await PATCH(
        createMockRequest('PATCH', { updates: [{ userId: MEMBER_ID, permissions: 'write' }] }),
        routeContext
      )

      expect(response.status).toBe(409)
      expect(dbChainMockFns.set).not.toHaveBeenCalled()
    })

    /**
     * Rewriting a row to the role it already holds would bump `updatedAt` and
     * emit a "from write to write" audit entry — noise in the trail, and a false
     * positive for anything watching `updatedAt` for real changes.
     */
    it('skips a member already at the requested role', async () => {
      queuePersonalWorkspace([permissionRow(ADMIN_ID, 'admin'), permissionRow(MEMBER_ID, 'write')])

      const response = await PATCH(
        createMockRequest('PATCH', { updates: [{ userId: MEMBER_ID, permissions: 'write' }] }),
        routeContext
      )

      expect(response.status).toBe(200)
      expect(dbChainMockFns.set).not.toHaveBeenCalled()
      expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
    })

    it('rejects a userId that is not already a workspace member', async () => {
      queuePersonalWorkspace([permissionRow(ADMIN_ID, 'admin')])

      const response = await PATCH(
        createMockRequest('PATCH', { updates: [{ userId: OUTSIDER_ID, permissions: 'read' }] }),
        routeContext
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'Only existing workspace members can have their permissions updated',
      })
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
      expect(dbChainMockFns.insert).not.toHaveBeenCalled()
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

    it('requires workspace admin access before reading the body', async () => {
      permissionsMockFns.mockHasWorkspaceAdminAccess.mockResolvedValue(false)

      const response = await PATCH(
        createMockRequest('PATCH', { updates: [{ userId: OUTSIDER_ID, permissions: 'read' }] }),
        routeContext
      )

      expect(response.status).toBe(403)
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })

    it('rejects an empty updates array', async () => {
      const response = await PATCH(createMockRequest('PATCH', { updates: [] }), routeContext)

      expect(response.status).toBe(400)
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
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

    /**
     * The exploit the dedup rule exists to stop: a leading `admin` entry satisfies
     * the self-demotion guard while a trailing `read` entry is what actually lands.
     */
    it('rejects a duplicate-entry attempt to self-demote', async () => {
      queuePersonalWorkspace([permissionRow(ADMIN_ID, 'admin')])

      const response = await PATCH(
        createMockRequest('PATCH', {
          updates: [
            { userId: ADMIN_ID, permissions: 'admin' },
            { userId: ADMIN_ID, permissions: 'read' },
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

    /**
     * An organization admin holds no permission row — their workspace admin is
     * derived — but the members list still shows them. Membership must therefore
     * mean "visible in the members list", or the caller is told someone they are
     * looking at is not a member instead of why the role is fixed.
     */
    it('explains the lock for an organization admin who holds no permission row', async () => {
      queueOrgWorkspace([{ userId: MEMBER_ID }], [permissionRow(ADMIN_ID, 'admin')])

      const response = await PATCH(
        createMockRequest('PATCH', { updates: [{ userId: MEMBER_ID, permissions: 'read' }] }),
        routeContext
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'Organization admins are workspace admins and their role cannot be changed',
      })
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

    it('does not consult the directory for a personal workspace', async () => {
      queuePersonalWorkspace([permissionRow(ADMIN_ID, 'admin'), permissionRow(MEMBER_ID, 'read')])
      dbChainMockFns.returning.mockResolvedValue([{ id: 'perm-1' }])

      await PATCH(
        createMockRequest('PATCH', { updates: [{ userId: MEMBER_ID, permissions: 'write' }] }),
        routeContext
      )

      expect(mockAssertMembershipNotScimManaged).not.toHaveBeenCalled()
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

    it('returns 404 when the workspace does not exist', async () => {
      const response = await PATCH(
        createMockRequest('PATCH', { updates: [{ userId: MEMBER_ID, permissions: 'read' }] }),
        routeContext
      )

      expect(response.status).toBe(404)
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })

    /**
     * Targets sharing a role share a statement, so a batch costs one write per
     * distinct role rather than one per member — the transaction holds its pooled
     * connection for a bounded number of round trips regardless of batch size.
     */
    it('writes one statement per distinct role, not per member', async () => {
      const members = ['user-a', 'user-b', 'user-c', 'user-d']
      queuePersonalWorkspace([
        permissionRow(ADMIN_ID, 'admin'),
        ...members.map((userId) => permissionRow(userId, 'read')),
      ])

      const response = await PATCH(
        createMockRequest('PATCH', {
          updates: members.map((userId) => ({ userId, permissions: 'write' })),
        }),
        routeContext
      )

      expect(response.status).toBe(200)
      expect(dbChainMockFns.set).toHaveBeenCalledTimes(1)
      expect(dbChainMockFns.set).toHaveBeenCalledWith({
        permissionType: 'write',
        updatedAt: expect.any(Date),
      })
    })

    it('applies every member of a multi-item batch', async () => {
      queuePersonalWorkspace([
        permissionRow(ADMIN_ID, 'admin'),
        permissionRow(MEMBER_ID, 'read'),
        permissionRow(OUTSIDER_ID, 'read'),
      ])
      dbChainMockFns.returning.mockResolvedValue([{ id: 'perm-1' }])

      const response = await PATCH(
        createMockRequest('PATCH', {
          updates: [
            { userId: OUTSIDER_ID, permissions: 'admin' },
            { userId: MEMBER_ID, permissions: 'write' },
          ],
        }),
        routeContext
      )

      expect(response.status).toBe(200)
      expect(dbChainMockFns.set).toHaveBeenCalledTimes(2)
      expect(dbChainMockFns.set).toHaveBeenCalledWith({
        permissionType: 'admin',
        updatedAt: expect.any(Date),
      })
      expect(dbChainMockFns.set).toHaveBeenCalledWith({
        permissionType: 'write',
        updatedAt: expect.any(Date),
      })
    })
  })
})
