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
vi.mock('@/ee/workspace-forking/lib/background-work/store', () => ({
  startBackgroundWork: vi.fn(),
}))
vi.mock('@/ee/workspace-forking/lib/copy/content-copy-runner', () => ({
  hasForkContentToCopy: vi.fn(() => false),
  scheduleForkContentCopy: vi.fn(),
}))
vi.mock('@/ee/workspace-forking/lib/copy/copy-workflows', () => ({
  copyWorkflowStateIntoTarget: vi.fn(),
  loadTargetDraftSubBlocks: vi.fn(async () => new Map()),
  loadWorkflowNameRegistry: vi.fn(async () => new Map()),
  resolveForkFolderMapping: mockResolveFolderMapping,
}))
vi.mock('@/ee/workspace-forking/lib/copy/storage-quota', () => ({
  sumForkCopyBytes: mockSumForkCopyBytes,
  assertForkStorageHeadroom: mockAssertForkStorageHeadroom,
}))
vi.mock('@/ee/workspace-forking/lib/copy/deploy-bridge', () => ({
  getActiveDeploymentVersionNumbers: vi.fn(async () => new Map()),
  loadSourceDeployedStates: mockLoadSourceDeployedStates,
}))
vi.mock('@/ee/workspace-forking/lib/lineage/lineage', () => ({
  acquireForkEdgeLock: vi.fn(),
  acquireForkTargetLock: vi.fn(),
  setForkLockTimeout: vi.fn(),
}))
vi.mock('@/ee/workspace-forking/lib/mapping/block-map-store', () => ({
  loadForkBlockMap: mockLoadBlockMap,
  reconcileForkBlockPairs: vi.fn(),
  toForkBlockPairs: vi.fn(() => []),
}))
vi.mock('@/ee/workspace-forking/lib/mapping/dependent-value-store', () => ({
  loadForkDependentValues: vi.fn(async () => []),
  reconcileForkDependentValues: vi.fn(),
  // Faithful mirror of the real pure translation (unit-tested in dependent-value-store.test.ts),
  // so promote's apply/reconcile paths exercise the actual source-doc-id rewrite.
  translateForkDependentValues: vi.fn(
    (
      values: Array<{ value: string }>,
      resolve: (kind: string, sourceId: string) => string | null | undefined
    ) =>
      values.map((entry) => {
        if (entry.value === '') return entry
        const translated = resolve('knowledge-document', entry.value)
        return translated != null && translated !== entry.value
          ? { ...entry, value: translated }
          : entry
      })
  ),
}))
vi.mock('@/ee/workspace-forking/lib/mapping/mapping-store', () => ({
  deleteWorkflowIdentityByIds: vi.fn(),
  upsertEdgeMappings: vi.fn(),
}))
vi.mock('@/ee/workspace-forking/lib/promote/cleared-refs', () => ({
  collectForkSyncBlockers: mockCollectBlockers,
}))
vi.mock('@/ee/workspace-forking/lib/promote/copy-unmapped', () => ({
  // Faithful mirror of the real overlay so a copy's id maps resolve through the augmented
  // resolver (the dependent-value translation and MCP meta read depend on it).
  augmentForkResolver: vi.fn(
    (
      base: (kind: string, sourceId: string) => string | null | undefined,
      extra: Map<string, Map<string, string>>
    ) =>
      (kind: string, sourceId: string) =>
        extra.get(kind)?.get(sourceId) ?? base(kind, sourceId)
  ),
  buildPromoteCopySelection: mockBuildCopySelection,
  copyPromoteUnmappedResources: mockCopyUnmapped,
  hasPromoteCopySelection: mockHasCopySelection,
}))
vi.mock('@/ee/workspace-forking/lib/promote/promote-plan', () => ({
  computeForkPromotePlan: mockComputePlan,
}))
vi.mock('@/ee/workspace-forking/lib/copy/copy-chats', () => ({
  copyForkChatDeployments: vi.fn(async () => ({ created: 0 })),
}))
vi.mock('@/ee/workspace-forking/lib/copy/workflow-mcp-attachments', () => ({
  reconcileForkWorkflowMcpAttachments: vi.fn(async () => ({ affectedServerIds: [] })),
}))
vi.mock('@/lib/mcp/workflow-mcp-sync', () => ({
  notifyMcpToolServers: vi.fn(),
}))
vi.mock('@/ee/workspace-forking/lib/promote/promote-run-store', () => ({
  upsertPromoteRun: mockUpsertPromoteRun,
}))
vi.mock('@/ee/workspace-forking/lib/mapping/resources', () => ({
  getMcpServerMetaByIds: mockGetMcpServerMeta,
}))
vi.mock('@/ee/workspace-forking/lib/remap/block-identity', () => ({
  buildForkBlockIdResolver: mockBuildBlockIdResolver,
}))
vi.mock('@/ee/workspace-forking/lib/remap/remap-references', () => ({
  createForkSubBlockTransform: mockCreateTransform,
}))
vi.mock('@/ee/workspace-forking/lib/socket', () => ({
  notifyForkWorkflowChanged: vi.fn(),
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUsersWithPermissions: mockGetUsersWithPermissions,
}))

import { db } from '@sim/db'
import { copyWorkflowStateIntoTarget } from '@/ee/workspace-forking/lib/copy/copy-workflows'
import { reconcileForkDependentValues } from '@/ee/workspace-forking/lib/mapping/dependent-value-store'
import { promoteFork } from '@/ee/workspace-forking/lib/promote/promote'
import type { ForkPromotePlan } from '@/ee/workspace-forking/lib/promote/promote-plan'

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

/** A copy result carrying no content/id maps, for tests that only need the copy to run. */
function emptyCopyResult() {
  return {
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
  }
}

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

describe('promoteFork gates', () => {
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

    expect(mockAssertForkStorageHeadroom).toHaveBeenCalledWith({
      targetWorkspaceId: 'tgt-ws',
      bytes: 999_999,
    })
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

describe('promoteFork dependent values', () => {
  it('unions the dependent-value picks into the copy discovery set (a re-picked document must be copied)', async () => {
    mockComputePlan.mockResolvedValue(
      makePlan({
        references: [
          {
            kind: 'knowledge-document',
            sourceId: 'doc-a',
            subBlockKey: 'documentSelector',
            required: false,
          },
        ],
      })
    )
    // No container selection: the document candidates alone must trigger the copy pass.
    mockHasCopySelection.mockReturnValue(false)
    mockCopyUnmapped.mockResolvedValue(emptyCopyResult())

    await promoteFork({
      ...promoteParams(),
      dependentValues: [
        // Duplicates the plan's own scan -> deduped.
        { workflowId: 'wf-t', blockId: 'b1', subBlockKey: 'documentSelector', value: 'doc-a' },
        // A fresh pick the source state does not reference -> must join the discovery set.
        { workflowId: 'wf-t', blockId: 'b2', subBlockKey: 'documentSelector', value: 'doc-b' },
        // Cleared values are skipped; non-document values ride along (DB-filtered downstream).
        { workflowId: 'wf-t', blockId: 'b3', subBlockKey: 'folder', value: '' },
        { workflowId: 'wf-t', blockId: 'b4', subBlockKey: 'folder', value: 'INBOX' },
      ],
    })

    expect(mockCopyUnmapped).toHaveBeenCalledTimes(1)
    expect(mockCopyUnmapped.mock.calls[0][0].referencedDocumentIds).toEqual([
      'doc-a',
      'doc-b',
      'INBOX',
    ])
  })

  it('translates a source document id under a copy-resolved KB for BOTH the written state and the store', async () => {
    const item = {
      sourceWorkflowId: 'wf-src',
      targetWorkflowId: 'wf-tgt',
      targetName: 'Flow',
      mode: 'replace' as const,
      sourceMeta: { name: 'Flow', description: null, folderId: null, sortOrder: 0 },
    }
    mockComputePlan.mockResolvedValue(makePlan({ items: [item] }))
    mockLoadSourceDeployedStates.mockResolvedValue({
      deployedWorkflows: [],
      sourceStates: new Map([
        ['wf-src', { blocks: {}, edges: [], loops: {}, parallels: {}, variables: {} }],
      ]),
    })
    // The KB is copy-selected; the copy assigns the picked source document its copied id.
    mockHasCopySelection.mockReturnValue(true)
    mockCopyUnmapped.mockResolvedValue({
      ...emptyCopyResult(),
      copyIdMapByKind: new Map([['knowledge-document', new Map([['doc-src', 'doc-copy']])]]),
    })
    vi.mocked(copyWorkflowStateIntoTarget).mockResolvedValue({
      targetWorkflowId: 'wf-tgt',
      mode: 'replace',
      name: 'Flow',
      blocksCount: 0,
      edgesCount: 0,
      subflowsCount: 0,
      clearedDependents: [],
      blockIdMapping: new Map(),
    })

    const result = await promoteFork({
      ...promoteParams(),
      copyResources: { knowledgeBases: ['kb-src'] },
      dependentValues: [
        {
          workflowId: 'wf-tgt',
          blockId: 'blk-1',
          subBlockKey: 'documentSelector',
          value: 'doc-src',
        },
      ],
    })

    expect(result.blocked).toBeNull()
    // The apply map the workflow write receives carries the COPIED id: the dependent-value
    // apply runs AFTER the reference remap and wins for its subblock, so a raw source id
    // would clobber the remapped value in the written state.
    expect(vi.mocked(copyWorkflowStateIntoTarget)).toHaveBeenCalledTimes(1)
    const writeParams = vi.mocked(copyWorkflowStateIntoTarget).mock.calls[0][0]
    expect(writeParams.dependentOverrides?.get('blk-1')?.get('documentSelector')).toBe('doc-copy')
    // The store persists the translated value too, so the next sync (whose parent is then
    // MAPPED via the persisted copy mapping) pre-fills a document id that resolves in the target.
    expect(vi.mocked(reconcileForkDependentValues)).toHaveBeenCalledWith(
      expect.anything(),
      'child-ws',
      ['wf-tgt'],
      [
        {
          targetWorkflowId: 'wf-tgt',
          targetBlockId: 'blk-1',
          subBlockKey: 'documentSelector',
          value: 'doc-copy',
        },
      ]
    )
  })

  it('keeps a mapped parent dependent value verbatim (a target-space value never re-translates)', async () => {
    const item = {
      sourceWorkflowId: 'wf-src',
      targetWorkflowId: 'wf-tgt',
      targetName: 'Flow',
      mode: 'replace' as const,
      sourceMeta: { name: 'Flow', description: null, folderId: null, sortOrder: 0 },
    }
    mockComputePlan.mockResolvedValue(makePlan({ items: [item] }))
    mockLoadSourceDeployedStates.mockResolvedValue({
      deployedWorkflows: [],
      sourceStates: new Map([
        ['wf-src', { blocks: {}, edges: [], loops: {}, parallels: {}, variables: {} }],
      ]),
    })
    // The value joins the discovery candidates, so the copy pass runs - and resolves nothing.
    mockCopyUnmapped.mockResolvedValue(emptyCopyResult())
    vi.mocked(copyWorkflowStateIntoTarget).mockResolvedValue({
      targetWorkflowId: 'wf-tgt',
      mode: 'replace',
      name: 'Flow',
      blocksCount: 0,
      edgesCount: 0,
      subflowsCount: 0,
      clearedDependents: [],
      blockIdMapping: new Map(),
    })

    await promoteFork({
      ...promoteParams(),
      dependentValues: [
        {
          workflowId: 'wf-tgt',
          blockId: 'blk-1',
          subBlockKey: 'documentSelector',
          value: 'doc-tgt-existing',
        },
      ],
    })

    const writeParams = vi.mocked(copyWorkflowStateIntoTarget).mock.calls[0][0]
    expect(writeParams.dependentOverrides?.get('blk-1')?.get('documentSelector')).toBe(
      'doc-tgt-existing'
    )
    expect(vi.mocked(reconcileForkDependentValues)).toHaveBeenCalledWith(
      expect.anything(),
      'child-ws',
      ['wf-tgt'],
      [
        {
          targetWorkflowId: 'wf-tgt',
          targetBlockId: 'blk-1',
          subBlockKey: 'documentSelector',
          value: 'doc-tgt-existing',
        },
      ]
    )
  })
})
