/**
 * @vitest-environment node
 */
import { workspace } from '@sim/db/schema'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import {
  workspaceAuthorizationMock,
  workspaceAuthorizationMockFns,
} from '@sim/testing/mocks/workspace-authorization.mock'
import { workspaceForkingAuthzMock } from '@sim/testing/mocks/workspace-forking-authz.mock'
import { workspaceForkingLineageMock } from '@sim/testing/mocks/workspace-forking-lineage.mock'
import {
  workspaceForkingLineageRootMock,
  workspaceForkingLineageRootMockFns,
} from '@sim/testing/mocks/workspace-forking-lineage-root.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveForkLineageRootId, mockResolveForkLineageWorkspaceIds } =
  workspaceForkingLineageRootMockFns

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/core/application/workspace-authorization', () => workspaceAuthorizationMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/ee/workspace-forking/lib/lineage/authz', () => workspaceForkingAuthzMock)
vi.mock('@/ee/workspace-forking/lib/lineage/lineage', () => workspaceForkingLineageMock)
vi.mock('@/ee/workspace-forking/lib/lineage/lineage-root', () => workspaceForkingLineageRootMock)

import { setForkSyncDefault } from '@/ee/workspace-forking/application/sync-default'

const principal = createSessionPrincipal({ userId: 'actor-1' })
const LINEAGE = ['root-ws', 'fork-a', 'fork-b', 'grandchild']

beforeEach(() => {
  resetDbChainMock()
  permissionsMockFns.mockGetWorkspaceWithOwner.mockResolvedValue({
    id: 'fork-a',
    name: 'Fork A',
    organizationId: null,
    allowPersonalApiKeys: true,
  })
  workspaceAuthorizationMockFns.mockAuthorizeWorkspaceOperation.mockResolvedValue(undefined)
  mockResolveForkLineageRootId.mockResolvedValue('root-ws')
  mockResolveForkLineageWorkspaceIds.mockResolvedValue(LINEAGE)
  // The live-member row lock, then the `UPDATE ... RETURNING` of the members that changed.
  queueTableRows(
    workspace,
    LINEAGE.map((id) => ({ id }))
  )
  dbChainMockFns.returning.mockResolvedValue(LINEAGE.map((id) => ({ id, name: `Name of ${id}` })))
})

const run = (excludeNewWorkflows: boolean) =>
  setForkSyncDefault.execute({
    principal,
    input: { workspaceId: 'fork-a', excludeNewWorkflows },
  })

describe('setForkSyncDefault', () => {
  /**
   * One entry per member, because the default genuinely changed for all of them. A single
   * entry on the calling workspace would leave the other members' admins with no record.
   */
  it("files one audit entry per updated member, in that member's own workspace and name", async () => {
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
      // The member's OWN name, not a raw id and not the caller's name.
      expect(entry.resourceName).toBe(`Name of ${entry.resourceId}`)
      expect(entry.metadata).toMatchObject({
        forkSyncNewWorkflowsExcluded: true,
        originWorkspaceId: 'fork-a',
        originWorkspaceName: 'Fork A',
      })
    }
  })

  /** An unlink that moved the caller out of the locked root's lineage must not be written. */
  it('refuses when the locked root no longer reaches the calling workspace', async () => {
    mockResolveForkLineageWorkspaceIds.mockResolvedValue(['root-ws', 'fork-b'])
    await expect(run(true)).rejects.toMatchObject({ statusCode: 409 })
  })
})
