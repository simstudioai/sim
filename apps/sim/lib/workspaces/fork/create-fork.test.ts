/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
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
  mockSeedEdgeMappings,
} = vi.hoisted(() => ({
  mockSumForkCopyBytes: vi.fn(),
  mockAssertForkStorageHeadroom: vi.fn(),
  mockLoadSourceDeployedStates: vi.fn(),
  mockPlanForkFileCopies: vi.fn(),
  mockCopyForkResourceContainers: vi.fn(),
  mockStartBackgroundWork: vi.fn(),
  mockFinishBackgroundWork: vi.fn(),
  mockScheduleForkContentCopy: vi.fn(),
  mockSeedEdgeMappings: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)
vi.mock('@/lib/workflows/defaults', () => ({
  buildDefaultWorkflowArtifacts: vi.fn(() => ({ workflowState: {} })),
}))
vi.mock('@/lib/workflows/persistence/utils', () => ({
  saveWorkflowToNormalizedTables: vi.fn(),
}))
vi.mock('@/lib/workspaces/fork/background-work/store', () => ({
  startBackgroundWork: mockStartBackgroundWork,
  finishBackgroundWork: mockFinishBackgroundWork,
}))
vi.mock('@/lib/workspaces/fork/copy/content-copy-runner', () => ({
  hasForkContentToCopy: vi.fn(() => false),
  scheduleForkContentCopy: mockScheduleForkContentCopy,
  serializeContentRefMaps: vi.fn(() => ({})),
}))
vi.mock('@/lib/workspaces/fork/copy/copy-chats', () => ({
  copyForkChatDeployments: vi.fn(async () => ({ created: 0 })),
}))
vi.mock('@/lib/workspaces/fork/copy/copy-files', () => ({
  planForkFileCopies: mockPlanForkFileCopies,
}))
vi.mock('@/lib/workspaces/fork/copy/workflow-mcp-attachments', () => ({
  copyForkWorkflowMcpAttachments: vi.fn(async () => ({ copied: 0 })),
}))
vi.mock('@/lib/workspaces/fork/copy/copy-resources', () => ({
  copyForkResourceContainers: mockCopyForkResourceContainers,
}))
vi.mock('@/lib/workspaces/fork/copy/storage-quota', () => ({
  sumForkCopyBytes: mockSumForkCopyBytes,
  assertForkStorageHeadroom: mockAssertForkStorageHeadroom,
}))
vi.mock('@/lib/workspaces/fork/copy/copy-workflows', () => ({
  copyWorkflowStateIntoTarget: vi.fn(),
  loadWorkflowNameRegistry: vi.fn(async () => new Map()),
  resolveForkFolderMapping: vi.fn(async () => new Map()),
}))
vi.mock('@/lib/workspaces/fork/copy/deploy-bridge', () => ({
  loadSourceDeployedStates: mockLoadSourceDeployedStates,
}))
vi.mock('@/lib/workspaces/fork/lineage/lineage', () => ({
  setForkLockTimeout: vi.fn(),
}))
vi.mock('@/lib/workspaces/fork/mapping/block-map-store', () => ({
  reconcileForkBlockPairs: vi.fn(),
  toForkBlockPairs: vi.fn(() => []),
}))
vi.mock('@/lib/workspaces/fork/mapping/mapping-store', () => ({
  seedEdgeMappings: mockSeedEdgeMappings,
}))
vi.mock('@/lib/workspaces/fork/remap/fork-bootstrap', () => ({
  createForkBootstrapTransform: vi.fn(() => (subBlocks: unknown) => subBlocks),
}))
vi.mock('@/lib/workspaces/fork/remap/reference-scan', () => ({
  collectReferencedDocumentIds: vi.fn(() => new Set<string>()),
}))
vi.mock('@/lib/workspaces/policy', () => ({
  WORKSPACE_MODE: {
    PERSONAL: 'personal',
    ORGANIZATION: 'organization',
    GRANDFATHERED_SHARED: 'grandfathered_shared',
  },
}))

import { createFork } from '@/lib/workspaces/fork/create-fork'

const SOURCE = { id: 'src-ws', name: 'Parent' } as never
const POLICY = {
  organizationId: null,
  workspaceMode: 'personal',
  billedAccountUserId: null,
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
    vi.clearAllMocks()
    resetDbChainMock()
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
    })
    mockCopyForkResourceContainers.mockResolvedValue({
      idMap: new Map(),
      mappingEntries: [],
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

    expect(mockAssertForkStorageHeadroom).toHaveBeenCalledWith({ userId: 'user-1', bytes: 999_999 })
    // Nothing was read, created, or recorded: the fork failed before all of it.
    expect(mockLoadSourceDeployedStates).not.toHaveBeenCalled()
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(mockStartBackgroundWork).not.toHaveBeenCalled()
  })

  it('proceeds under quota, summing exactly the selected files + knowledge bases', async () => {
    mockSumForkCopyBytes.mockResolvedValue(500)

    const result = await createFork(forkParams({ files: ['wf-1'], knowledgeBases: ['kb-1'] }))

    expect(result.workspace.name).toBe('My Fork')
    expect(result.workflowsCopied).toBe(0)
    expect(mockSumForkCopyBytes).toHaveBeenCalledWith(expect.anything(), 'src-ws', {
      fileIds: ['wf-1'],
      knowledgeBaseIds: ['kb-1'],
    })
    expect(mockAssertForkStorageHeadroom).toHaveBeenCalledWith({ userId: 'user-1', bytes: 500 })
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
  })

  it('seeds identity mappings for copied FILES by storage key (a later sync must not re-offer them)', async () => {
    mockPlanForkFileCopies.mockResolvedValue({
      keyMap: new Map([['workspace/src-ws/a.png', 'workspace/child/a.png']]),
      idMap: new Map([['file-1', 'file-1-copy']]),
      blobTasks: [],
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
