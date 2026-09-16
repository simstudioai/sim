/**
 * @vitest-environment node
 */
import type { SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rollback: vi.fn(),
  activity: vi.fn(),
  analytics: vi.fn(),
  audit: vi.fn(),
  authorize: vi.fn(),
  workspace: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    WORKSPACE_FORK_ROLLED_BACK: 'workspace.fork.rolled_back',
    WORKSPACE_FORK_UNLINKED: 'workspace.fork.unlinked',
    WORKFLOW_FORK_SYNC_EXCLUDED: 'workflow.fork_sync.excluded',
    WORKFLOW_FORK_SYNC_INCLUDED: 'workflow.fork_sync.included',
  },
  AuditResourceType: { WORKSPACE: 'workspace' },
  recordAudit: mocks.audit,
}))
vi.mock('@/lib/core/application/workspace-authorization', () => ({
  authorizeWorkspaceOperation: mocks.authorize,
  requireAllowedWorkspacePrincipal: vi.fn(),
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceWithOwner: mocks.workspace,
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.analytics }))
vi.mock('@/ee/workspace-forking/lib/lineage/authz', () => ({ assertForkingEnabled: vi.fn() }))
vi.mock('@/ee/workspace-forking/lib/lineage/lineage', () => ({
  acquireForkEdgeLock: vi.fn(),
  setForkLockTimeout: vi.fn(),
  resolveForkEdge: vi.fn(),
}))
vi.mock('@/ee/workspace-forking/lib/lineage/unlink', () => ({ unlinkForkEdge: vi.fn() }))
vi.mock('@/ee/workspace-forking/lib/mapping/dependent-value-store', () => ({
  reconcileForkDependentValues: vi.fn(),
}))
vi.mock('@/ee/workspace-forking/lib/mapping/mapping-service', () => ({
  applyForkMappingEntries: vi.fn(),
  overlayForkMappingEntries: vi.fn(),
  validateForkMappingTargets: vi.fn(),
}))
vi.mock('@/ee/workspace-forking/lib/mapping/mapping-store', () => ({
  getEdgeMappingRows: vi.fn(),
}))
vi.mock('@/ee/workspace-forking/lib/promote/rollback', () => ({ rollbackFork: mocks.rollback }))
vi.mock('@/ee/workspace-forking/lib/background-work/store', () => ({
  recordBackgroundWork: mocks.activity,
}))

import {
  rollbackWorkspaceFork,
  updateWorkspaceForkExclusions,
} from '@/ee/workspace-forking/application/recovery-and-mappings'

const principal: SessionPrincipal = {
  kind: 'session',
  userId: 'actor-1',
  sessionId: 'session-1',
}
const rollbackResult = {
  restored: 2,
  archived: 1,
  unarchived: 0,
  skipped: 0,
  skippedIds: [],
  pendingActivations: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.workspace.mockResolvedValue({
    id: 'target',
    name: 'Destination',
    organizationId: null,
    allowPersonalApiKeys: true,
  })
  mocks.authorize.mockResolvedValue(undefined)
  mocks.rollback.mockResolvedValue(rollbackResult)
  mocks.activity.mockResolvedValue(undefined)
})

describe('shared fork rollback effects', () => {
  it.each([
    { pendingActivations: [], skipped: 0, status: 'completed' },
    { pendingActivations: [], skipped: 1, status: 'completed_with_warnings' },
    { pendingActivations: ['workflow-1'], skipped: 0, status: 'completed_with_warnings' },
  ])(
    'records activity with $status for $skipped skipped workflows and $pendingActivations pending deployments',
    async ({ pendingActivations, skipped, status }) => {
      const result = { ...rollbackResult, pendingActivations, skipped }
      mocks.rollback.mockResolvedValue(result)
      queueTableRows(workspace, [{ name: 'Source', actorName: 'Acting user' }])

      await expect(
        rollbackWorkspaceFork.execute({
          principal,
          input: { workspaceId: 'target', otherWorkspaceId: 'source' },
        })
      ).resolves.toEqual(result)

      expect(mocks.activity).toHaveBeenCalledWith(db, {
        workspaceId: 'target',
        kind: 'fork_rollback',
        status,
        message: pendingActivations.length
          ? 'Undid the last sync from "Source" — 1 deployment(s) still activating'
          : 'Undid the last sync from "Source"',
        metadata: {
          actorName: 'Acting user',
          otherWorkspaceId: 'source',
          otherWorkspaceName: 'Source',
          restored: 2,
          removed: 1,
          unarchived: 0,
          skipped,
          pendingActivations: pendingActivations.length,
        },
      })
      expect(mocks.audit).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'actor-1',
          resourceId: 'target',
          resourceName: 'Destination',
          description: 'Rolled back the last promote into "Destination"',
        })
      )
    }
  )

  it('keeps a committed rollback successful if activity recording fails', async () => {
    mocks.activity.mockRejectedValue(new Error('Activity storage unavailable'))
    await expect(
      rollbackWorkspaceFork.execute({
        principal,
        input: { workspaceId: 'target', otherWorkspaceId: 'source' },
      })
    ).resolves.toEqual(rollbackResult)
    expect(mocks.activity).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        message: 'Undid the last sync from "the source workspace"',
      })
    )
  })

  it('does not record activity or audit when rollback refuses before commit', async () => {
    mocks.rollback.mockRejectedValue(new Error('No rollback point'))
    await expect(
      rollbackWorkspaceFork.execute({
        principal,
        input: { workspaceId: 'target', otherWorkspaceId: 'source' },
      })
    ).rejects.toThrow('No rollback point')
    expect(mocks.activity).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
})

describe('shared fork exclusion effects', () => {
  it.each([true, false])(
    'captures changed workflow counts and bounded audit names for excluded=%s',
    async (forkSyncExcluded) => {
      const rows = Array.from({ length: 25 }, (_, index) => ({
        id: `workflow-${index}`,
        name: `Workflow ${index}`,
      }))
      dbChainMockFns.returning.mockResolvedValueOnce(rows)

      const result = await updateWorkspaceForkExclusions.execute({
        principal,
        input: { workspaceId: 'target', workflowIds: rows.map((row) => row.id), forkSyncExcluded },
      })

      expect(result.updated).toBe(25)
      expect(mocks.audit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: forkSyncExcluded ? 'workflow.fork_sync.excluded' : 'workflow.fork_sync.included',
          resourceName: 'Destination',
          metadata: expect.objectContaining({
            forkSyncExcluded,
            workflowCount: 25,
            workflowNames: rows.slice(0, 20).map((row) => row.name),
          }),
        })
      )
      expect(mocks.analytics).toHaveBeenCalledWith(
        'actor-1',
        'fork_excluded_workflows_updated',
        {
          workspace_id: 'target',
          workflow_count: 25,
          fork_sync_excluded: forkSyncExcluded,
        },
        { groups: { workspace: 'target' } }
      )
    }
  )

  it('emits no audit or analytics for an unchanged exclusion set', async () => {
    const result = await updateWorkspaceForkExclusions.execute({
      principal,
      input: { workspaceId: 'target', workflowIds: ['unchanged'], forkSyncExcluded: true },
    })
    expect(result.updated).toBe(0)
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.analytics).not.toHaveBeenCalled()
  })
})
