import { workspace } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { workflowsPersistenceUtilsMock } from '@sim/testing/mocks/workflows-persistence-utils.mock'
import {
  workspaceForkingLineageMock,
  workspaceForkingLineageMockFns,
} from '@sim/testing/mocks/workspace-forking-lineage.mock'
import { workspaceForkingLineageRootMock } from '@sim/testing/mocks/workspace-forking-lineage-root.mock'
import {
  workspaceForkingMappingStoreMock,
  workspaceForkingMappingStoreMockFns,
} from '@sim/testing/mocks/workspace-forking-mapping-store.mock'
import {
  workspaceForkingRevisionMock,
  workspaceForkingRevisionMockFns,
} from '@sim/testing/mocks/workspace-forking-revision.mock'
import { workspacesPolicyMock } from '@sim/testing/mocks/workspaces-policy.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockSumForkCopyBytes,
  mockAssertForkStorageHeadroom,
  mockLoadSourceDeployedStates,
  mockPlanForkFileCopies,
  mockCopyForkResourceContainers,
  mockStartBackgroundWork,
  mockFinishBackgroundWork,
  mockScheduleForkContentCopy,
  mockCollectReferencedFileFolderPaths,
} = vi.hoisted(() => ({
  mockSumForkCopyBytes: vi.fn(),
  mockAssertForkStorageHeadroom: vi.fn(),
  mockLoadSourceDeployedStates: vi.fn(),
  mockPlanForkFileCopies: vi.fn(),
  mockCopyForkResourceContainers: vi.fn(),
  mockStartBackgroundWork: vi.fn(),
  mockFinishBackgroundWork: vi.fn(),
  mockScheduleForkContentCopy: vi.fn(),
  mockCollectReferencedFileFolderPaths: vi.fn(() => new Set<string>()),
}))

vi.mock('@/lib/workflows/defaults', () => ({
  buildDefaultWorkflowArtifacts: vi.fn(() => ({ workflowState: {} })),
}))
vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)
vi.mock('@/ee/workspace-forking/lib/background-work/store', () => ({
  startBackgroundWork: mockStartBackgroundWork,
  finishBackgroundWork: mockFinishBackgroundWork,
}))
vi.mock('@/ee/workspace-forking/lib/copy/content-copy-runner', () => ({
  hasForkContentToCopy: vi.fn(() => false),
  scheduleForkContentCopy: mockScheduleForkContentCopy,
  serializeContentRefMaps: vi.fn(() => ({})),
}))
vi.mock('@/ee/workspace-forking/lib/copy/copy-chats', () => ({
  copyForkChatDeployments: vi.fn(async () => ({ created: 0 })),
}))
vi.mock('@/ee/workspace-forking/lib/copy/copy-files', () => ({
  planForkFileCopies: mockPlanForkFileCopies,
}))
vi.mock('@/ee/workspace-forking/lib/copy/workflow-mcp-attachments', () => ({
  copyForkWorkflowMcpAttachments: vi.fn(async () => ({ copied: 0 })),
}))
vi.mock('@/ee/workspace-forking/lib/copy/copy-resources', () => ({
  copyForkResourceContainers: mockCopyForkResourceContainers,
}))
vi.mock('@/ee/workspace-forking/lib/copy/storage-quota', () => ({
  sumForkCopyBytes: mockSumForkCopyBytes,
  assertForkStorageHeadroom: mockAssertForkStorageHeadroom,
}))
vi.mock('@/ee/workspace-forking/lib/copy/copy-workflows', () => ({
  copyWorkflowStateIntoTarget: vi.fn(),
  loadWorkflowNameRegistry: vi.fn(async () => new Map()),
  resolveForkFolderMapping: vi.fn(async () => ({
    folderIdMap: new Map(),
    folderPathMap: new Map(),
  })),
}))
vi.mock('@/ee/workspace-forking/lib/copy/deploy-bridge', () => ({
  loadSourceDeployedStates: mockLoadSourceDeployedStates,
}))
vi.mock('@/ee/workspace-forking/lib/lineage/lineage', () => workspaceForkingLineageMock)
vi.mock('@/ee/workspace-forking/application/revision', () => workspaceForkingRevisionMock)
vi.mock('@/lib/workspaces/operations/receipts', () => ({
  findWorkspaceOperationReceipt: vi.fn(async () => null),
  insertWorkspaceOperationReceipt: vi.fn(async () => {}),
  lockWorkspaceOperationRequest: vi.fn(async () => {}),
}))
vi.mock('@/ee/workspace-forking/lib/lineage/lineage-root', () => workspaceForkingLineageRootMock)
vi.mock('@/ee/workspace-forking/lib/mapping/block-map-store', () => ({
  reconcileForkBlockPairs: vi.fn(),
  toForkBlockPairs: vi.fn(() => []),
}))
vi.mock('@/ee/workspace-forking/lib/mapping/mapping-store', () => workspaceForkingMappingStoreMock)
vi.mock('@/ee/workspace-forking/lib/remap/fork-bootstrap', () => ({
  createForkBootstrapTransform: vi.fn(() => (subBlocks: unknown) => subBlocks),
  createForkBlockTypeTransform: vi.fn(() => (blockType: string) => blockType),
}))
vi.mock('@/lib/workflows/references/reference-scan', () => ({
  collectReferencedDocumentIds: vi.fn(() => new Set<string>()),
  collectReferencedFileFolderPaths: mockCollectReferencedFileFolderPaths,
}))
vi.mock('@/lib/workspaces/policy', () => workspacesPolicyMock)

import { createFork } from '@/ee/workspace-forking/lib/create-fork'

const { mockLockForkRevision } = workspaceForkingRevisionMockFns

const { mockSeedEdgeMappings } = workspaceForkingMappingStoreMockFns

const SOURCE = { id: 'src-ws', name: 'Parent', allowPersonalApiKeys: false } as never
const POLICY = {
  organizationId: null,
  workspaceMode: 'personal',
  billedAccountUserId: 'user-1',
} as never

function forkParams(selection?: {
  files?: string[]
  knowledgeBases?: string[]
}): Parameters<typeof createFork>[0] {
  return {
    source: SOURCE,
    policy: POLICY,
    userId: 'user-1',
    name: 'My Fork',
    selection: {
      files: selection?.files ?? [],
      tables: [],
      knowledgeBases: selection?.knowledgeBases ?? [],
      customTools: [],
      skills: [],
      mcpServers: [],
      workflowMcpServers: [],
    },
    requestId: 'test',
  }
}

describe('createFork storage headroom gate', () => {
  beforeEach(() => {
    resetDbChainMock()
    /**
     * The fork transaction re-reads the parent's organization under the lock to
     * confirm it has not moved since `assertCanFork` captured the policy.
     * Matches POLICY.organizationId, so the fork proceeds.
     */
    queueTableRows(workspace, [{ organizationId: null }])
    mockSumForkCopyBytes.mockResolvedValue(0)
    mockAssertForkStorageHeadroom.mockResolvedValue(undefined)
    mockLoadSourceDeployedStates.mockResolvedValue({
      deployedWorkflows: [],
      sourceStates: new Map(),
    })
    mockPlanForkFileCopies.mockResolvedValue({
      keyMap: new Map(),
      idMap: new Map(),
      blobTasks: [],
      folderIdMap: new Map(),
      folderPathMap: new Map(),
    })
    mockCopyForkResourceContainers.mockResolvedValue({
      idMap: new Map(),
      mappingEntries: [],
      folderIdMap: new Map(),
      contentPlan: {
        sourceWorkspaceId: 'src-ws',
        childWorkspaceId: 'child-ws',
        userId: 'user-1',
        tables: [],
        knowledgeBases: [],
        skills: [],
        documents: [],
      },
      names: {
        tables: [],
        knowledgeBases: [],
        customTools: [],
        skills: [],
        mcpServers: [],
        workflowMcpServers: [],
      },
    })
    mockStartBackgroundWork.mockResolvedValue('status-1')
    mockFinishBackgroundWork.mockResolvedValue(undefined)
  })

  it('fails an over-quota fork BEFORE any read or write, with the storage error', async () => {
    mockSumForkCopyBytes.mockResolvedValue(999_999)
    mockAssertForkStorageHeadroom.mockRejectedValue(
      new Error(
        'Not enough storage to copy the selected resources. Storage limit exceeded. Used: 10.50GB, Limit: 10GB'
      )
    )

    await expect(
      createFork(forkParams({ files: ['wf-1'], knowledgeBases: ['kb-1'] }))
    ).rejects.toThrow('Not enough storage to copy the selected resources')

    expect(mockAssertForkStorageHeadroom).toHaveBeenCalledWith({
      plannedWorkspaceId: expect.any(String),
      creationPolicy: POLICY,
      bytes: 999_999,
    })
    // Nothing was read, created, or recorded: the fork failed before all of it.
    expect(mockLoadSourceDeployedStates).not.toHaveBeenCalled()
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(mockStartBackgroundWork).not.toHaveBeenCalled()
  })

  it('refuses when the parent changed organizations after the policy was captured', async () => {
    resetDbChainMock()
    /**
     * `assertCanFork` captures `policy.organizationId` before this transaction,
     * so an admin workspace move committing in between would otherwise leave
     * the fork locking the organization the parent has already left and
     * inserting the child there — the cross-organization edge the lock exists
     * to prevent. The parent is re-read under the lock to catch exactly this.
     */
    queueTableRows(workspace, [{ organizationId: 'org-moved-away' }])
    mockSumForkCopyBytes.mockResolvedValue(0)

    await expect(createFork(forkParams())).rejects.toThrow(
      'changed organizations while this fork was being created'
    )
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  /**
   * Both inherited workspace policies in one fork. `forkSyncNewWorkflowsExcluded` is set
   * to `true` (not the default) so the assertion cannot pass on a hardcoded `false`: the
   * new-workflow fork-sync default is lineage-uniform, and a child that did not inherit it
   * would disagree with its parent from the moment it exists.
   */
  it('gives the child the source workspace personal API-key and fork-sync policies', async () => {
    resetDbChainMock()
    queueTableRows(workspace, [{ organizationId: null, forkSyncNewWorkflowsExcluded: true }])

    const result = await createFork(forkParams())

    expect(result.workspace.allowPersonalApiKeys).toBe(false)
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        allowPersonalApiKeys: false,
        forkSyncNewWorkflowsExcluded: true,
      })
    )
  })

  /**
   * The deadlock guard, asserted where the order actually lives. `fork-lock-order.integration.ts`
   * proves this ORDER is the correct one against real Postgres; this proves `createFork`
   * follows it. Without this, reordering these two calls would leave every check green:
   * the integration suite drives the helpers itself and never calls `createFork`.
   *
   * `lockForkRevision` takes `FOR UPDATE` on the source `workspace` row, which
   * `unlinkForkEdge` updates while holding the lineage key. Taking it first closes a
   * genuine cycle. Ranks 2 then 5 in the table on `acquireForkLineageLock`.
   */
  it('takes the lineage lock before the revision lock, closing the unlink deadlock', async () => {
    await createFork({
      ...forkParams(),
      admission: {
        workspaceId: 'src-ws',
        requestId: 'req-1',
        requestHash: 'hash-1',
        previewFingerprint: 'fp-1',
        choices: {},
      },
    })

    const lineageAt =
      workspaceForkingLineageMockFns.mockAcquireForkLineageLock.mock.invocationCallOrder[0]
    const revisionAt = mockLockForkRevision.mock.invocationCallOrder[0]
    expect(lineageAt).toBeDefined()
    expect(revisionAt).toBeDefined()
    expect(lineageAt).toBeLessThan(revisionAt)
  })

  it('seeds identity mappings for copied FILES by storage key (a later sync must not re-offer them)', async () => {
    mockPlanForkFileCopies.mockResolvedValue({
      keyMap: new Map([['workspace/src-ws/a.png', 'workspace/child/a.png']]),
      idMap: new Map([['file-1', 'file-1-copy']]),
      blobTasks: [],
      folderIdMap: new Map(),
      folderPathMap: new Map(),
    })

    await createFork(forkParams({ files: ['file-1'] }))

    expect(mockSeedEdgeMappings).toHaveBeenCalledTimes(1)
    const seeded = mockSeedEdgeMappings.mock.calls[0][3] as Array<Record<string, unknown>>
    expect(seeded).toContainEqual({
      resourceType: 'file',
      parentResourceId: 'workspace/src-ws/a.png',
      childResourceId: 'workspace/child/a.png',
    })
  })
})
