import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import {
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
} from '@sim/testing/mocks/workflows-persistence-utils.mock'
import { workspaceForkingLineageMock } from '@sim/testing/mocks/workspace-forking-lineage.mock'
import { workspaceForkingMappingStoreMock } from '@sim/testing/mocks/workspace-forking-mapping-store.mock'
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
  mockGetMcpServerMeta,
  mockCreateTransform,
  mockSumForkCopyBytes,
  mockAssertForkStorageHeadroom,
  mockLoadTargetWebhookPaths,
  mockVerifyDrops,
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
  mockGetMcpServerMeta: vi.fn(),
  mockCreateTransform: vi.fn(),
  mockSumForkCopyBytes: vi.fn(),
  mockAssertForkStorageHeadroom: vi.fn(),
  mockLoadTargetWebhookPaths: vi.fn(),
  mockVerifyDrops: vi.fn(),
}))

vi.mock('@/lib/workflows/deployment-outbox', () => ({
  enqueueWorkflowUndeploySideEffects: vi.fn(),
  processWorkflowDeploymentOutboxEvent: vi.fn(),
}))
vi.mock('@/lib/workflows/orchestration/deploy', () => ({
  performFullDeploy: vi.fn(async () => ({ success: true })),
}))
vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)
vi.mock('@/ee/workspace-forking/lib/background-work/store', () => ({
  recordBackgroundWork: vi.fn(),
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
  loadTargetWebhookPathsByBlock: mockLoadTargetWebhookPaths,
}))
vi.mock('@/ee/workspace-forking/lib/lineage/lineage', () => workspaceForkingLineageMock)
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
vi.mock('@/ee/workspace-forking/lib/mapping/mapping-store', () => workspaceForkingMappingStoreMock)
vi.mock('@/ee/workspace-forking/lib/promote/cleared-refs', () => ({
  collectForkSyncBlockers: mockCollectBlockers,
  verifyForkDropAcknowledgments: mockVerifyDrops,
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
vi.mock('@/lib/workflows/references/resources', () => ({
  getMcpServerMetaByIds: mockGetMcpServerMeta,
}))
vi.mock('@/ee/workspace-forking/lib/remap/block-identity', () => ({
  buildForkBlockIdResolver: mockBuildBlockIdResolver,
}))
vi.mock('@/lib/workflows/references/remap-references', () => ({
  createForkSubBlockTransform: mockCreateTransform,
}))
vi.mock('@/ee/workspace-forking/lib/socket', () => ({
  notifyForkWorkflowChanged: vi.fn(),
}))
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { db } from '@sim/db'
import { performFullDeploy } from '@/lib/workflows/orchestration/deploy'
import { getBlock } from '@/blocks/registry'
import { copyWorkflowStateIntoTarget } from '@/ee/workspace-forking/lib/copy/copy-workflows'
import { reconcileForkDependentValues } from '@/ee/workspace-forking/lib/mapping/dependent-value-store'
import { promoteFork } from '@/ee/workspace-forking/lib/promote/promote'
import type { ForkPromotePlan } from '@/ee/workspace-forking/lib/promote/promote-plan'

const mockGetUsersWithPermissions = permissionsMockFns.mockGetUsersWithPermissions

workflowsPersistenceUtilsMockFns.mockUndeployWorkflow.mockResolvedValue({ success: true })

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
    excludedTargets: [],
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
    otherWorkspaceName: 'Parent',
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
  mockCollectBlockers.mockResolvedValue({ blockers: [], appliedDrops: [] })
  mockLoadBlockMap.mockResolvedValue(new Map())
  mockBuildBlockIdResolver.mockReturnValue((_wf: string, blockId: string) => blockId)
  mockResolveFolderMapping.mockResolvedValue({ folderIdMap: new Map(), folderPathMap: new Map() })
  mockUpsertPromoteRun.mockResolvedValue('run-1')
  mockGetMcpServerMeta.mockResolvedValue(new Map())
  mockCreateTransform.mockReturnValue((subBlocks: unknown) => subBlocks)
  mockSumForkCopyBytes.mockResolvedValue(0)
  mockAssertForkStorageHeadroom.mockResolvedValue(undefined)
  mockLoadTargetWebhookPaths.mockResolvedValue(new Map())
  // Default: no acknowledgments, so the unmapped gate behaves exactly as before.
  mockVerifyDrops.mockResolvedValue([])
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

  /**
   * A source-deleted reference on a REQUIRED field sits in `unmappedRequired`, and that gate runs
   * before the cleared-ref gate that honours drops. Without subtracting verified drops here, Drop
   * was inert for exactly the references it exists to unblock - the sync still failed with
   * "map all required ... first".
   */
  it('lets a VERIFIED drop clear the unmapped gate for a required reference', async () => {
    mockComputePlan.mockResolvedValue(
      makePlan({
        unmappedRequired: [
          { kind: 'table', sourceId: 'tbl-gone', subBlockKey: 'tableSelector', required: true },
        ],
      })
    )
    mockVerifyDrops.mockResolvedValue([{ kind: 'table', sourceId: 'tbl-gone' }])

    const result = await promoteFork({
      ...promoteParams(),
      dropReferences: [{ kind: 'table', sourceId: 'tbl-gone' }],
    })

    expect(result.blocked).toBeNull()
    // The SAME verified set reaches the cleared-ref gate, so one liveness check governs both.
    expect(mockCollectBlockers).toHaveBeenCalledWith(
      expect.objectContaining({ droppedReferences: [{ kind: 'table', sourceId: 'tbl-gone' }] })
    )
  })

  it('blocks with the structured blocker list when references would clear, writing NOTHING', async () => {
    mockCollectBlockers.mockResolvedValue({ blockers: [BLOCKER], appliedDrops: [] })

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
})

describe('promoteFork trigger URLs', () => {
  beforeEach(() => {
    // A block only holds a public URL when its config declares a `useWebhookUrl` field, so the
    // fixture has to look like a webhook trigger to the shared predicate.
    vi.mocked(getBlock).mockReturnValue({
      category: 'triggers',
      subBlocks: [{ id: 'triggerWebhookUrl', useWebhookUrl: true }],
    } as never)
  })

  const triggerState = {
    blocks: {
      'blk-new': {
        id: 'blk-new',
        // The REAL slack_webhook trigger id, so the provider check resolves against the actual
        // registry - adoption only pairs a URL with a trigger of the SAME provider.
        type: 'slack_webhook',
        name: 'Slack messages',
        triggerMode: true,
        subBlocks: {},
        outputs: {},
        enabled: true,
      },
    },
    edges: [],
    loops: {},
    parallels: {},
    variables: {},
  }

  function arrangeReCreatedTrigger() {
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
      sourceStates: new Map([['wf-src', triggerState]]),
    })
    // The old trigger block ('blk-old') serves the live URL and is NOT in the source any more:
    // the user deleted and re-added the trigger, so the sync writes 'blk-new' instead.
    mockLoadTargetWebhookPaths.mockResolvedValue(
      new Map([['blk-old', { path: 'live-slack-path', workflowId: 'wf-tgt', provider: 'slack' }]])
    )
    vi.mocked(copyWorkflowStateIntoTarget).mockResolvedValue({
      targetWorkflowId: 'wf-tgt',
      mode: 'replace',
      name: 'Flow',
      blocksCount: 1,
      edgesCount: 0,
      subflowsCount: 0,
      clearedDependents: [],
      blockIdMapping: new Map(),
    })
  }

  /**
   * The reported bug, at the promote level: pushing a workflow whose Slack trigger was re-created
   * used to hand the parent a brand-new webhook URL, forcing a re-paste into Slack every sync.
   */
  it('hands the retiring URL to the arriving trigger instead of minting a new one', async () => {
    arrangeReCreatedTrigger()

    const result = await promoteFork(promoteParams())

    expect(result.blocked).toBeNull()
    const writeParams = vi.mocked(copyWorkflowStateIntoTarget).mock.calls[0][0]
    expect(writeParams.triggerPathByBlockId?.get('blk-new')).toBe('live-slack-path')
    // Adopted, so nothing needs re-registering externally.
    expect(result.triggerUrlChanges).toEqual([])
  })

  it('rejects an invalid source-scoped choice before writing the workflow or scheduling deployment', async () => {
    arrangeReCreatedTrigger()
    await expect(
      promoteFork({
        ...promoteParams(),
        triggerMappings: [
          {
            sourceWorkflowId: 'wf-src',
            sourceBlockId: 'blk-new',
            adoptPath: 'someone-elses-path',
          },
        ],
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(copyWorkflowStateIntoTarget).not.toHaveBeenCalled()
    expect(mockUpsertPromoteRun).not.toHaveBeenCalled()
    expect(performFullDeploy).not.toHaveBeenCalled()
  })
})
