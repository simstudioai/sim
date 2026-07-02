/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ForkSyncBlocker } from '@/lib/api/contracts/workspace-fork'

const {
  mockComputePlan,
  mockBuildCopySelection,
  mockHasCopySelection,
  mockCopyUnmapped,
  mockCollectBlockers,
  mockLoadBlockMap,
  mockBuildBlockIdResolver,
  mockResolveFolderMapping,
  mockUpsertPromoteRun,
  mockLoadSourceDeployedStates,
  mockGetUsersWithPermissions,
  mockGetMcpServerMeta,
  mockCreateTransform,
  mockSumForkCopyBytes,
  mockAssertForkStorageHeadroom,
} = vi.hoisted(() => ({
  mockComputePlan: vi.fn(),
  mockBuildCopySelection: vi.fn(),
  mockHasCopySelection: vi.fn(),
  mockCopyUnmapped: vi.fn(),
  mockCollectBlockers: vi.fn(),
  mockLoadBlockMap: vi.fn(),
  mockBuildBlockIdResolver: vi.fn(),
  mockResolveFolderMapping: vi.fn(),
  mockUpsertPromoteRun: vi.fn(),
  mockLoadSourceDeployedStates: vi.fn(),
  mockGetUsersWithPermissions: vi.fn(),
  mockGetMcpServerMeta: vi.fn(),
  mockCreateTransform: vi.fn(),
  mockSumForkCopyBytes: vi.fn(),
  mockAssertForkStorageHeadroom: vi.fn(),
}))

vi.mock('@/lib/workflows/deployment-outbox', () => ({
  enqueueWorkflowUndeploySideEffects: vi.fn(),
  processWorkflowDeploymentOutboxEvent: vi.fn(),
}))
vi.mock('@/lib/workflows/orchestration/deploy', () => ({
  performFullDeploy: vi.fn(async () => ({ success: true })),
}))
vi.mock('@/lib/workflows/persistence/utils', () => ({
  undeployWorkflow: vi.fn(async () => ({ success: true })),
}))
vi.mock('@/lib/workspaces/fork/background-work/store', () => ({
  startBackgroundWork: vi.fn(),
}))
vi.mock('@/lib/workspaces/fork/copy/content-copy-runner', () => ({
  hasForkContentToCopy: vi.fn(() => false),
  scheduleForkContentCopy: vi.fn(),
}))
vi.mock('@/lib/workspaces/fork/copy/copy-workflows', () => ({
  copyWorkflowStateIntoTarget: vi.fn(),
  loadTargetDraftSubBlocks: vi.fn(async () => new Map()),
  loadWorkflowNameRegistry: vi.fn(async () => new Map()),
  resolveForkFolderMapping: mockResolveFolderMapping,
}))
vi.mock('@/lib/workspaces/fork/copy/storage-quota', () => ({
  sumForkCopyBytes: mockSumForkCopyBytes,
  assertForkStorageHeadroom: mockAssertForkStorageHeadroom,
}))
vi.mock('@/lib/workspaces/fork/copy/deploy-bridge', () => ({
  getActiveDeploymentVersionNumbers: vi.fn(async () => new Map()),
  loadSourceDeployedStates: mockLoadSourceDeployedStates,
}))
vi.mock('@/lib/workspaces/fork/lineage/lineage', () => ({
  acquireForkEdgeLock: vi.fn(),
  acquireForkTargetLock: vi.fn(),
  setForkLockTimeout: vi.fn(),
}))
vi.mock('@/lib/workspaces/fork/mapping/block-map-store', () => ({
  loadForkBlockMap: mockLoadBlockMap,
  reconcileForkBlockPairs: vi.fn(),
  toForkBlockPairs: vi.fn(() => []),
}))
vi.mock('@/lib/workspaces/fork/mapping/dependent-value-store', () => ({
  loadForkDependentValues: vi.fn(async () => []),
  reconcileForkDependentValues: vi.fn(),
}))
vi.mock('@/lib/workspaces/fork/mapping/mapping-store', () => ({
  deleteWorkflowIdentityByIds: vi.fn(),
  upsertEdgeMappings: vi.fn(),
}))
vi.mock('@/lib/workspaces/fork/promote/cleared-refs', () => ({
  collectForkSyncBlockers: mockCollectBlockers,
}))
vi.mock('@/lib/workspaces/fork/promote/copy-unmapped', () => ({
  augmentForkResolver: vi.fn((base) => base),
  buildPromoteCopySelection: mockBuildCopySelection,
  copyPromoteUnmappedResources: mockCopyUnmapped,
  hasPromoteCopySelection: mockHasCopySelection,
}))
vi.mock('@/lib/workspaces/fork/promote/promote-plan', () => ({
  computeForkPromotePlan: mockComputePlan,
}))
vi.mock('@/lib/workspaces/fork/promote/promote-run-store', () => ({
  upsertPromoteRun: mockUpsertPromoteRun,
}))
vi.mock('@/lib/workspaces/fork/mapping/resources', () => ({
  getMcpServerMetaByIds: mockGetMcpServerMeta,
}))
vi.mock('@/lib/workspaces/fork/remap/block-identity', () => ({
  buildForkBlockIdResolver: mockBuildBlockIdResolver,
}))
vi.mock('@/lib/workspaces/fork/remap/remap-references', () => ({
  createForkSubBlockTransform: mockCreateTransform,
}))
vi.mock('@/lib/workspaces/fork/socket', () => ({
  notifyForkWorkflowChanged: vi.fn(),
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUsersWithPermissions: mockGetUsersWithPermissions,
}))

import { db } from '@sim/db'
import { promoteFork } from '@/lib/workspaces/fork/promote/promote'
import type { ForkPromotePlan } from '@/lib/workspaces/fork/promote/promote-plan'

const EDGE = { childWorkspaceId: 'child-ws', parentWorkspaceId: 'parent-ws' }

const EMPTY_SELECTION = {
  customTools: [],
  skills: [],
  tables: [],
  knowledgeBases: [],
  files: [],
}

function makePlan(overrides: Partial<ForkPromotePlan> = {}): ForkPromotePlan {
  return {
    childWorkspaceId: EDGE.childWorkspaceId,
    sourceWorkspaceId: 'src-ws',
    targetWorkspaceId: 'tgt-ws',
    direction: 'push',
    resolver: () => null,
    items: [],
    workflowIdMap: new Map(),
    archivedTargetIds: [],
    archivedTargets: [],
    references: [],
    unmappedRequired: [],
    unmappedOptional: [],
    mcpReauthServerIds: [],
    inlineSecretSources: [],
    copyableUnmapped: [],
    willUpdate: 0,
    willCreate: 0,
    willArchive: 0,
    ...overrides,
  }
}

const BLOCKER: ForkSyncBlocker = {
  workflowName: 'Caller',
  blockLabel: 'Table Block',
  fieldLabel: 'Table',
  kind: 'table',
  sourceId: 'tbl-1',
  sourceLabel: 'Orders',
  reason: 'unmapped-copyable',
}

function promoteParams() {
  return {
    edge: EDGE as never,
    sourceWorkspaceId: 'src-ws',
    targetWorkspaceId: 'tgt-ws',
    direction: 'push' as const,
    userId: 'user-1',
  }
}

describe('promoteFork gates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.transaction).mockImplementation(
      async (cb: (tx: unknown) => unknown) => cb({}) as never
    )
    mockGetUsersWithPermissions.mockResolvedValue([])
    mockLoadSourceDeployedStates.mockResolvedValue({
      deployedWorkflows: [],
      sourceStates: new Map(),
    })
    mockComputePlan.mockResolvedValue(makePlan())
    mockBuildCopySelection.mockReturnValue({
      selection: EMPTY_SELECTION,
      willResolve: new Set<string>(),
    })
    mockHasCopySelection.mockReturnValue(false)
    mockCollectBlockers.mockResolvedValue([])
    mockLoadBlockMap.mockResolvedValue(new Map())
    mockBuildBlockIdResolver.mockReturnValue((_wf: string, blockId: string) => blockId)
    mockResolveFolderMapping.mockResolvedValue(new Map())
    mockUpsertPromoteRun.mockResolvedValue('run-1')
    mockGetMcpServerMeta.mockResolvedValue(new Map())
    mockCreateTransform.mockReturnValue((subBlocks: unknown) => subBlocks)
    mockSumForkCopyBytes.mockResolvedValue(0)
    mockAssertForkStorageHeadroom.mockResolvedValue(undefined)
  })

  it('blocks an over-quota copy selection before any lock, read, or write', async () => {
    mockSumForkCopyBytes.mockResolvedValue(999_999)
    mockAssertForkStorageHeadroom.mockRejectedValue(
      new Error(
        'Not enough storage to copy the selected resources. Storage limit exceeded. Used: 10.50GB, Limit: 10GB'
      )
    )

    await expect(
      promoteFork({
        ...promoteParams(),
        copyResources: { files: ['workspace/src-ws/key-1'], knowledgeBases: ['kb-1'] },
      })
    ).rejects.toThrow('Not enough storage to copy the selected resources')

    expect(mockAssertForkStorageHeadroom).toHaveBeenCalledWith({ userId: 'user-1', bytes: 999_999 })
    // Fails fast: no source-state loads, no locked transaction, no writes of any kind.
    expect(mockLoadSourceDeployedStates).not.toHaveBeenCalled()
    expect(db.transaction).not.toHaveBeenCalled()
    expect(mockUpsertPromoteRun).not.toHaveBeenCalled()
  })

  it('sums the requested copy selection bytes against the SOURCE workspace (files by key, KBs by id)', async () => {
    await promoteFork({
      ...promoteParams(),
      copyResources: {
        files: ['workspace/src-ws/key-1'],
        knowledgeBases: ['kb-1'],
        tables: ['tbl-1'],
      },
    })

    expect(mockSumForkCopyBytes).toHaveBeenCalledTimes(1)
    expect(mockSumForkCopyBytes).toHaveBeenCalledWith(expect.anything(), 'src-ws', {
      fileKeys: ['workspace/src-ws/key-1'],
      knowledgeBaseIds: ['kb-1'],
    })
  })

  it('blocks on unmapped required credentials/secrets BEFORE the cleared-refs gate runs', async () => {
    mockComputePlan.mockResolvedValue(
      makePlan({
        unmappedRequired: [
          { kind: 'credential', sourceId: 'c1', subBlockKey: 'credential', required: true },
        ],
      })
    )

    const result = await promoteFork(promoteParams())

    expect(result.blocked).toBe('unmapped')
    expect(result.unmappedRequired).toEqual([
      { kind: 'credential', sourceId: 'c1', required: true, blockName: undefined },
    ])
    expect(result.blockers).toEqual([])
    expect(mockCollectBlockers).not.toHaveBeenCalled()
    expect(mockResolveFolderMapping).not.toHaveBeenCalled()
    expect(mockUpsertPromoteRun).not.toHaveBeenCalled()
  })

  it('blocks with the structured blocker list when references would clear, writing NOTHING', async () => {
    mockCollectBlockers.mockResolvedValue([BLOCKER])

    const result = await promoteFork(promoteParams())

    expect(result.blocked).toBe('cleared-refs')
    expect(result.blockers).toEqual([BLOCKER])
    expect(result.promoteRunId).toBe('')
    expect(result.updated).toBe(0)
    expect(result.created).toBe(0)
    expect(result.archived).toBe(0)
    // Blocked before the first write: no folder creation, no resource copy, no undo point.
    expect(mockResolveFolderMapping).not.toHaveBeenCalled()
    expect(mockCopyUnmapped).not.toHaveBeenCalled()
    expect(mockUpsertPromoteRun).not.toHaveBeenCalled()
  })

  it('evaluates the gate against the plan resolver overlaid with the copy selection', async () => {
    const planResolver = vi.fn(() => 'plan-resolved')
    mockComputePlan.mockResolvedValue(makePlan({ resolver: planResolver }))
    mockBuildCopySelection.mockReturnValue({
      selection: EMPTY_SELECTION,
      willResolve: new Set(['table:t1']),
    })

    await promoteFork(promoteParams())

    expect(mockCollectBlockers).toHaveBeenCalledTimes(1)
    const gateParams = mockCollectBlockers.mock.calls[0][0]
    // A copy-selected reference resolves through the overlay (never hits the plan resolver);
    // everything else falls through to the plan's persisted-mapping resolver.
    expect(gateParams.resolver('table', 't1')).toBe('t1')
    expect(planResolver).not.toHaveBeenCalled()
    expect(gateParams.resolver('table', 't2')).toBe('plan-resolved')
    expect(planResolver).toHaveBeenCalledWith('table', 't2')
  })

  it('threads the SAME block-id resolver into the gate and the resource copy as the workflow writes', async () => {
    // Copied tables' workflow-group outputs must land on the block ids the sync actually writes
    // (persisted pairs preferred over derive), so the copy receives the resolver built from the
    // loaded block map - the identical instance the cleared-refs gate uses.
    const resolver = (_workflowId: string, blockId: string) => `pair-${blockId}`
    mockBuildBlockIdResolver.mockReturnValue(resolver)
    mockHasCopySelection.mockReturnValue(true)
    mockCopyUnmapped.mockResolvedValue({
      contentPlan: {
        sourceWorkspaceId: 'src-ws',
        childWorkspaceId: 'tgt-ws',
        userId: 'user-1',
        tables: [],
        knowledgeBases: [],
        skills: [],
        documents: [],
      },
      copyIdMapByKind: new Map(),
      contentRefMaps: {},
      blobTasks: [],
    })

    await promoteFork(promoteParams())

    expect(mockCopyUnmapped).toHaveBeenCalledTimes(1)
    expect(mockCopyUnmapped.mock.calls[0][0].resolveBlockId).toBe(resolver)
    expect(mockCollectBlockers.mock.calls[0][0].resolveBlockId).toBe(resolver)
  })

  it('proceeds when zero references would clear (empty blocker list)', async () => {
    const plan = makePlan()
    mockComputePlan.mockResolvedValue(plan)

    const result = await promoteFork(promoteParams())

    expect(result.blocked).toBeNull()
    expect(result.blockers).toEqual([])
    expect(result.promoteRunId).toBe('run-1')
    expect(mockCollectBlockers).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceWorkspaceId: 'src-ws',
        items: plan.items,
        workflowIdMap: plan.workflowIdMap,
      })
    )
    expect(mockUpsertPromoteRun).toHaveBeenCalledTimes(1)
  })

  it("threads the plan's unmapped references into the gate so it can reuse the plan's scan", async () => {
    const unmappedOptional = [
      { kind: 'table' as const, sourceId: 'tbl-1', subBlockKey: 'tbl', required: false },
    ]
    mockComputePlan.mockResolvedValue(makePlan({ unmappedOptional }))

    await promoteFork(promoteParams())

    expect(mockCollectBlockers).toHaveBeenCalledWith(
      expect.objectContaining({ planUnmapped: unmappedOptional })
    )
  })

  it('batch-loads the mapped TARGET MCP server rows and threads them into the subblock transform', async () => {
    // Two references resolving to the SAME target and one unmapped: the read must cover the
    // distinct mapped target ids only (one bounded query, unmapped ids dropped).
    const resolver = (kind: string, id: string) => {
      if (kind !== 'mcp-server') return null
      if (id === 'srv-a' || id === 'srv-b') return 'srv-tgt'
      return null
    }
    mockComputePlan.mockResolvedValue(
      makePlan({
        resolver,
        references: [
          { kind: 'mcp-server', sourceId: 'srv-a', subBlockKey: 'tools', required: false },
          { kind: 'mcp-server', sourceId: 'srv-b', subBlockKey: 'server', required: false },
          { kind: 'mcp-server', sourceId: 'srv-unmapped', subBlockKey: 'tools', required: false },
        ],
      })
    )
    mockGetMcpServerMeta.mockResolvedValue(
      new Map([['srv-tgt', { name: 'Target Server', url: 'https://target.example/mcp' }]])
    )

    await promoteFork(promoteParams())

    expect(mockGetMcpServerMeta).toHaveBeenCalledTimes(1)
    expect(mockGetMcpServerMeta).toHaveBeenCalledWith(expect.anything(), 'tgt-ws', ['srv-tgt'])
    // The transform receives a lookup resolving the TARGET id to its row metadata, so remapped
    // tool-input entries rewrite their embedded serverUrl/serverName from the target server.
    expect(mockCreateTransform).toHaveBeenCalledTimes(1)
    const [, transformOptions] = mockCreateTransform.mock.calls[0]
    expect(transformOptions.resolveMcpServerMeta('srv-tgt')).toEqual({
      name: 'Target Server',
      url: 'https://target.example/mcp',
    })
    expect(transformOptions.resolveMcpServerMeta('srv-unknown')).toBeUndefined()
  })
})
