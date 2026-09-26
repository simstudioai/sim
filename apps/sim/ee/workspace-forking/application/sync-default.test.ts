/**
 * @vitest-environment node
 */
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { posthogServerMock, posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
import {
  workspaceAuthorizationMock,
  workspaceAuthorizationMockFns,
} from '@sim/testing/mocks/workspace-authorization.mock'
import { workspaceForkingAuthzMock } from '@sim/testing/mocks/workspace-forking-authz.mock'
import { workspaceForkingLineageMock } from '@sim/testing/mocks/workspace-forking-lineage.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  resolveRootId: vi.fn(),
  resolveLineage: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/core/application/workspace-authorization', () => workspaceAuthorizationMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/ee/workspace-forking/lib/lineage/authz', () => workspaceForkingAuthzMock)
vi.mock('@/ee/workspace-forking/lib/lineage/lineage', () => workspaceForkingLineageMock)
vi.mock('@/ee/workspace-forking/lib/sync-default', () => ({
  resolveForkLineageRootId: hoisted.resolveRootId,
  resolveForkLineageWorkspaceIds: hoisted.resolveLineage,
}))

import { setForkSyncDefault } from '@/ee/workspace-forking/application/sync-default'

const principal = createSessionPrincipal({ userId: 'actor-1' })
const LINEAGE = ['root-ws', 'fork-a', 'fork-b', 'grandchild']

beforeEach(() => {
  resetDbChainMock()
  vi.clearAllMocks()
  permissionsMockFns.mockGetWorkspaceWithOwner.mockResolvedValue({
    id: 'fork-a',
    name: 'Fork A',
    organizationId: null,
    allowPersonalApiKeys: true,
  })
  workspaceAuthorizationMockFns.mockAuthorizeWorkspaceOperation.mockResolvedValue(undefined)
  hoisted.resolveRootId.mockResolvedValue('root-ws')
  hoisted.resolveLineage.mockResolvedValue(LINEAGE)
  // The use case's single `UPDATE ... RETURNING` over the global @sim/db mock: the rows it
  // returns are the lineage members whose value actually changed.
  dbChainMockFns.returning.mockResolvedValue(LINEAGE.map((id) => ({ id })))
})

const run = (excludeNewWorkflows: boolean) =>
  setForkSyncDefault.execute({
    principal,
    input: { workspaceId: 'fork-a', excludeNewWorkflows },
  })

describe('setForkSyncDefault', () => {
  it('writes every lineage member when issued from a mid-lineage fork', async () => {
    await expect(run(true)).resolves.toMatchObject({
      excludeNewWorkflows: true,
      workspacesUpdated: LINEAGE.length,
      changedWorkspaceIds: LINEAGE,
    })
  })

  /**
   * One entry per member, because the default genuinely changed for all of them. A single
   * entry on the calling workspace would leave the other members' admins with no record.
   */
  it('records one entry per CHANGED member, naming where the change was issued from', async () => {
    await run(true)
    const audited = auditMockFns.mockRecordAudit.mock.calls.map(([entry]) => entry)
    expect(audited).toHaveLength(LINEAGE.length)
    expect(audited.map((entry) => entry.resourceId).sort()).toEqual([...LINEAGE].sort())
    for (const entry of audited) {
      expect(entry.action).toBe('workspace.fork_sync_default_changed')
      // Filed in the workspace it describes. Without an explicit workspaceId the wrapper
      // defaults it to the caller's workspace, so every entry would pile into one log and
      // the other members' admins would see nothing.
      expect(entry.workspaceId).toBe(entry.resourceId)
      expect(entry.metadata).toMatchObject({
        forkSyncNewWorkflowsExcluded: true,
        originWorkspaceId: 'fork-a',
        originWorkspaceName: 'Fork A',
      })
    }
  })

  it('writes no audit and no analytics when the value already matched everywhere', async () => {
    dbChainMockFns.returning.mockResolvedValue([])
    await expect(run(true)).resolves.toMatchObject({
      workspacesUpdated: 0,
      changedWorkspaceIds: [],
    })
    expect(auditMockFns.mockRecordAudit.mock.calls).toHaveLength(0)
    expect(posthogServerMockFns.mockCaptureServerEvent.mock.calls).toHaveLength(0)
  })

  /**
   * The update only touches members whose value differs, so auditing the whole lineage
   * would file a change record against a workspace that already held the requested value.
   */
  it('records nothing for a member that already held the requested value', async () => {
    dbChainMockFns.returning.mockResolvedValue([{ id: 'fork-b' }])
    await expect(run(true)).resolves.toMatchObject({
      workspacesUpdated: 1,
      changedWorkspaceIds: ['fork-b'],
    })
    const audited = auditMockFns.mockRecordAudit.mock.calls.map(([entry]) => entry)
    expect(audited.map((entry) => entry.resourceId)).toEqual(['fork-b'])
  })

  /**
   * The fan-out reaches workspaces the caller may not administer, so the admission check
   * is the only thing standing between a non-admin and a lineage-wide write. Assert it
   * rejects rather than trusting that the wrapper was wired up.
   */
  it('rejects a caller who fails workspace admission, writing nothing', async () => {
    workspaceAuthorizationMockFns.mockAuthorizeWorkspaceOperation.mockRejectedValue(
      new Error('forbidden')
    )
    await expect(run(true)).rejects.toThrow('forbidden')
    expect(auditMockFns.mockRecordAudit.mock.calls).toHaveLength(0)
  })

  it('carries the chosen value through, so turning the default back on is symmetric', async () => {
    await expect(run(false)).resolves.toMatchObject({ excludeNewWorkflows: false })
    const [entry] = auditMockFns.mockRecordAudit.mock.calls[0]
    expect(entry.metadata).toMatchObject({ forkSyncNewWorkflowsExcluded: false })
  })
})
