import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubBlockConfig } from '@/blocks/types'

// The reference indexer resolves a tool's params via the tool registry; stub it so loading the
// remap module never pulls the full registry (these cases use top-level selectors / dependents).
vi.mock('@/tools/params', () => ({
  getToolIdForOperation: () => undefined,
  getSubBlocksForToolInput: (
    _toolId: string,
    _type: string,
    _values: unknown,
    _modes: unknown,
    provided?: { subBlocks?: SubBlockConfig[] }
  ) => ({ subBlocks: provided?.subBlocks ?? [] }),
  formatParameterLabel: (label: string) => label,
}))

// The liveness annotation + gate label loading go through the mapping resource helpers; mocked so
// each case controls which source ids read as still-alive and which labels resolve.
const { mockFilterExisting, mockLoadCopyableLabels } = vi.hoisted(() => ({
  mockFilterExisting: vi.fn(),
  mockLoadCopyableLabels: vi.fn(),
}))
vi.mock('@/lib/workflows/references/resources', () => ({
  filterExistingForkTargets: mockFilterExisting,
  loadForkCopyableResourceLabels: mockLoadCopyableLabels,
  getWorkspaceEnvKeys: vi.fn(),
  listForkCopyableSourceResources: vi.fn(),
  listForkResourceCandidates: vi.fn(),
  getCredentialProvidersByIds: vi.fn(),
  classifyCredentialResourceType: vi.fn(),
  CANDIDATE_LIMIT: 1000,
}))

import type { DbOrTx } from '@/lib/db/types'
import type { ForkReferenceResolver } from '@/lib/workflows/references/remap-references'
import { getBlock } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import {
  annotateForkClearedRefSourceLiveness,
  collectForkClearedRefCandidates,
  collectForkSyncBlockers,
} from '@/ee/workspace-forking/lib/promote/cleared-refs'
import { buildPromoteWorkflowIdMap } from '@/ee/workspace-forking/lib/promote/promote-plan'
import {
  buildForkBlockIdResolver,
  deriveForkBlockId,
  EMPTY_FORK_BLOCK_MAP,
} from '@/ee/workspace-forking/lib/remap/block-identity'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const blockWith = (subBlocks: SubBlockConfig[]): BlockConfig =>
  ({ name: 'Test', description: '', subBlocks, outputs: {} }) as unknown as BlockConfig

// No persisted block map, so the resolver derives - matching the deriveForkBlockId expectations.
const resolveBlockId = buildForkBlockIdResolver(true, EMPTY_FORK_BLOCK_MAP)

const stateWith = (
  blockType: string,
  blockName: string,
  subBlocks: Record<string, { type?: string; value: unknown }>
): WorkflowState =>
  ({
    blocks: { 'block-1': { id: 'block-1', type: blockType, name: blockName, subBlocks } },
    edges: [],
    loops: {},
    parallels: {},
    variables: {},
  }) as unknown as WorkflowState

interface ParamOverrides {
  items?: Array<{
    sourceWorkflowId: string
    targetWorkflowId: string
    mode: 'create' | 'replace'
    sourceMeta: { name: string }
  }>
  sourceStates?: Map<string, WorkflowState>
  resolver?: ForkReferenceResolver
  workflowIdMap?: Map<string, string>
  sourceLabels?: Map<string, string>
  sourceWorkflowNames?: Map<string, string>
}

const params = (overrides: ParamOverrides) => ({
  items: [],
  sourceStates: new Map<string, WorkflowState>(),
  resolver: (() => null) as ForkReferenceResolver,
  workflowIdMap: new Map<string, string>(),
  resolveBlockId,
  sourceLabels: new Map<string, string>(),
  sourceWorkflowNames: new Map<string, string>(),
  ...overrides,
})

const targetBlockId = deriveForkBlockId('wf-tgt', 'block-1')

describe('collectForkClearedRefCandidates', () => {
  it('emits an unmapped knowledge-base reference (cause reference) with block + field labels', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([{ id: 'kb', title: 'Knowledge Base', type: 'knowledge-base-selector' }])
    )
    const result = collectForkClearedRefCandidates(
      params({
        items: [
          {
            sourceWorkflowId: 'wf-src',
            targetWorkflowId: 'wf-tgt',
            mode: 'replace',
            sourceMeta: { name: 'Search' },
          },
        ],
        sourceStates: new Map([
          [
            'wf-src',
            stateWith('knowledge', 'KB Block', {
              kb: { type: 'knowledge-base-selector', value: 'kb-src' },
            }),
          ],
        ]),
        resolver: () => null,
        sourceLabels: new Map([['knowledge-base:kb-src', 'Docs KB']]),
      })
    )
    expect(result).toEqual([
      {
        targetWorkflowId: 'wf-tgt',
        workflowName: 'Search',
        blockId: targetBlockId,
        blockLabel: 'KB Block',
        fieldLabel: 'Knowledge Base',
        kind: 'knowledge-base',
        sourceId: 'kb-src',
        sourceLabel: 'Docs KB',
        cause: 'reference',
        // Collected as false; source liveness is annotated afterwards (DB check).
        sourceDeleted: false,
      },
    ])
  })

  it('drops a reference once the resolver maps it (so a mapped resource is not "cleared")', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([{ id: 'kb', title: 'Knowledge Base', type: 'knowledge-base-selector' }])
    )
    const result = collectForkClearedRefCandidates(
      params({
        items: [
          {
            sourceWorkflowId: 'wf-src',
            targetWorkflowId: 'wf-tgt',
            mode: 'replace',
            sourceMeta: { name: 'Search' },
          },
        ],
        sourceStates: new Map([
          [
            'wf-src',
            stateWith('knowledge', 'KB Block', {
              kb: { type: 'knowledge-base-selector', value: 'kb-src' },
            }),
          ],
        ]),
        resolver: (kind, id) => (kind === 'knowledge-base' && id === 'kb-src' ? 'kb-tgt' : null),
      })
    )
    expect(result).toEqual([])
  })

  it('excludes a required credential reference (a blocker resolved by mapping, never cleared)', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([{ id: 'credential', title: 'Account', type: 'oauth-input' }])
    )
    const result = collectForkClearedRefCandidates(
      params({
        items: [
          {
            sourceWorkflowId: 'wf-src',
            targetWorkflowId: 'wf-tgt',
            mode: 'replace',
            sourceMeta: { name: 'Send Email' },
          },
        ],
        sourceStates: new Map([
          [
            'wf-src',
            stateWith('gmail', 'Gmail 1', {
              credential: { type: 'oauth-input', value: 'cred-src' },
            }),
          ],
        ]),
        // An unmapped required credential gates Sync; it must not appear as a "will be cleared" item.
        resolver: () => null,
        sourceLabels: new Map([['credential:cred-src', 'Work Gmail']]),
      })
    )
    expect(result).toEqual([])
  })

  it('emits a workflow reference to a workflow not carried into the target (cause workflow)', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([{ id: 'target', title: 'Workflow', type: 'workflow-selector' }])
    )
    const result = collectForkClearedRefCandidates(
      params({
        items: [
          {
            sourceWorkflowId: 'wf-src',
            targetWorkflowId: 'wf-tgt',
            mode: 'replace',
            sourceMeta: { name: 'Caller' },
          },
        ],
        sourceStates: new Map([
          [
            'wf-src',
            stateWith('workflow_caller', 'Run Subflow', {
              target: { type: 'workflow-selector', value: 'wf-other' },
            }),
          ],
        ]),
        workflowIdMap: new Map(),
        sourceWorkflowNames: new Map([['wf-other', 'Other Workflow']]),
      })
    )
    expect(result).toEqual([
      {
        targetWorkflowId: 'wf-tgt',
        workflowName: 'Caller',
        blockId: targetBlockId,
        blockLabel: 'Run Subflow',
        fieldLabel: 'Workflow',
        kind: 'workflow',
        sourceId: 'wf-other',
        sourceLabel: 'Other Workflow',
        cause: 'workflow',
      },
    ])
  })

  it('collapses the workflowId pair to the active member: manual active emits nothing, basic selector still clears', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        {
          id: 'workflowId',
          title: 'Workflow',
          type: 'workflow-selector',
          canonicalParamId: 'workflowId',
          mode: 'basic',
        },
        {
          id: 'manualWorkflowId',
          title: 'Workflow ID',
          type: 'short-input',
          canonicalParamId: 'workflowId',
          mode: 'advanced',
        },
      ])
    )
    const item = {
      sourceWorkflowId: 'wf-src',
      targetWorkflowId: 'wf-tgt',
      mode: 'replace' as const,
      sourceMeta: { name: 'Caller' },
    }

    // Advanced (manual) mode active; the dormant basic selector holds a stale, uncopied id. The
    // manual member is user-owned (never cleared) and the dormant basic selector is collapsed away,
    // so NO workflow cleared-ref rows even when nothing is carried into the target.
    const advancedState = {
      blocks: {
        'block-1': {
          id: 'block-1',
          type: 'workflow',
          name: 'Caller',
          data: { canonicalModes: { workflowId: 'advanced' } },
          subBlocks: {
            workflowId: { type: 'workflow-selector', value: 'wf-old' },
            manualWorkflowId: { type: 'short-input', value: 'wf-active' },
          },
        },
      },
      edges: [],
      loops: {},
      parallels: {},
      variables: {},
    } as unknown as WorkflowState
    const manualActive = collectForkClearedRefCandidates(
      params({
        items: [item],
        sourceStates: new Map([['wf-src', advancedState]]),
        sourceWorkflowNames: new Map([['wf-active', 'Active Workflow']]),
      })
    )
    expect(manualActive.filter((ref) => ref.cause === 'workflow')).toEqual([])

    // Active BASIC selector path unbroken: an uncopied selector value still produces a workflow row.
    const basicState = {
      blocks: {
        'block-1': {
          id: 'block-1',
          type: 'workflow',
          name: 'Caller',
          data: { canonicalModes: { workflowId: 'basic' } },
          subBlocks: {
            workflowId: { type: 'workflow-selector', value: 'wf-basic' },
            manualWorkflowId: { type: 'short-input', value: 'wf-active' },
          },
        },
      },
      edges: [],
      loops: {},
      parallels: {},
      variables: {},
    } as unknown as WorkflowState
    const basicActive = collectForkClearedRefCandidates(
      params({
        items: [item],
        sourceStates: new Map([['wf-src', basicState]]),
        sourceWorkflowNames: new Map([['wf-basic', 'Basic Workflow']]),
      })
    )
    const workflowRows = basicActive.filter((ref) => ref.cause === 'workflow')
    expect(workflowRows).toHaveLength(1)
    expect(workflowRows[0].sourceId).toBe('wf-basic')
  })

  // The sim workspace-event trigger's workflow filter: a multi-select `dropdown` with baseKey
  // `workflowIds` (options are workspace workflow ids). Uncarried ids are dropped by the remap,
  // so they must surface as workflow-cause cleared refs / sync blockers.
  it('emits workflow refs for the workspace-event trigger workflowIds dropdown (uncarried ids)', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([{ id: 'workflowIds', title: 'Workflows', type: 'dropdown', multiSelect: true }])
    )
    const result = collectForkClearedRefCandidates(
      params({
        items: [
          {
            sourceWorkflowId: 'wf-src',
            targetWorkflowId: 'wf-tgt',
            mode: 'replace',
            sourceMeta: { name: 'Alerts' },
          },
        ],
        sourceStates: new Map([
          [
            'wf-src',
            stateWith('sim_workspace_event', 'Workspace Events', {
              workflowIds: { type: 'dropdown', value: ['wf-watched', 'wf-carried'] },
            }),
          ],
        ]),
        workflowIdMap: new Map([['wf-carried', 'wf-carried-tgt']]),
        sourceWorkflowNames: new Map([['wf-watched', 'Watched Workflow']]),
      })
    )
    expect(result).toEqual([
      {
        targetWorkflowId: 'wf-tgt',
        workflowName: 'Alerts',
        blockId: targetBlockId,
        blockLabel: 'Workspace Events',
        fieldLabel: 'Workflows',
        kind: 'workflow',
        sourceId: 'wf-watched',
        sourceLabel: 'Watched Workflow',
        cause: 'workflow',
      },
    ])
  })

  it('does not emit manual manualWorkflowIds values as workflow cleared-refs', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        {
          id: 'workflowSelector',
          title: 'Workflows',
          type: 'dropdown',
          canonicalParamId: 'workflowIds',
          mode: 'basic',
        },
        {
          id: 'manualWorkflowIds',
          title: 'Workflow IDs',
          type: 'short-input',
          canonicalParamId: 'workflowIds',
          mode: 'advanced',
        },
      ])
    )
    // Active advanced manual list holds uncopied ids: user-owned, so never a workflow cleared-ref.
    const state = {
      blocks: {
        'block-1': {
          id: 'block-1',
          type: 'logs',
          name: 'Logs',
          data: { canonicalModes: { workflowIds: 'advanced' } },
          subBlocks: {
            workflowSelector: { type: 'dropdown', value: [] },
            manualWorkflowIds: { type: 'short-input', value: 'wf-a,wf-b' },
          },
        },
      },
      edges: [],
      loops: {},
      parallels: {},
      variables: {},
    } as unknown as WorkflowState
    const result = collectForkClearedRefCandidates(
      params({
        items: [
          {
            sourceWorkflowId: 'wf-src',
            targetWorkflowId: 'wf-tgt',
            mode: 'replace',
            sourceMeta: { name: 'Logs' },
          },
        ],
        sourceStates: new Map([['wf-src', state]]),
        workflowIdMap: new Map(),
      })
    )
    expect(result.filter((ref) => ref.cause === 'workflow')).toEqual([])
  })

  it('emits a configured create-target dependent a remapped parent will clear (cause dependent)', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        {
          id: 'folder',
          title: 'Label',
          type: 'folder-selector',
          dependsOn: ['credential'],
          selectorKey: 'gmail.labels',
        },
      ])
    )
    // Entries carry no `type`, so the credential is not a direct (category-A) reference here -
    // isolating the create-dependent (category-C) path: the label hangs off the credential.
    const result = collectForkClearedRefCandidates(
      params({
        items: [
          {
            sourceWorkflowId: 'wf-src',
            targetWorkflowId: 'wf-tgt',
            mode: 'create',
            sourceMeta: { name: 'New Workflow' },
          },
        ],
        sourceStates: new Map([
          [
            'wf-src',
            stateWith('gmail', 'Gmail', {
              credential: { value: 'cred-src' },
              folder: { value: 'INBOX' },
            }),
          ],
        ]),
        sourceLabels: new Map([['credential:cred-src', 'Work Gmail']]),
      })
    )
    expect(result).toEqual([
      {
        targetWorkflowId: 'wf-tgt',
        workflowName: 'New Workflow',
        blockId: targetBlockId,
        blockLabel: 'Gmail',
        fieldLabel: 'Label',
        kind: 'credential',
        sourceId: 'cred-src',
        sourceLabel: 'Work Gmail',
        cause: 'dependent',
        parentKind: 'credential',
        parentSourceId: 'cred-src',
      },
    ])
  })

  it('carries the knowledge-base parent on a document-selector dependent (so it can drop off)', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        {
          id: 'knowledgeBaseSelector',
          title: 'Knowledge Base',
          type: 'knowledge-base-selector',
          canonicalParamId: 'knowledgeBaseId',
        },
        {
          id: 'documentSelector',
          title: 'Document',
          type: 'document-selector',
          canonicalParamId: 'documentId',
          selectorKey: 'knowledge.documents',
          dependsOn: ['knowledgeBaseSelector'],
        },
      ])
    )
    const result = collectForkClearedRefCandidates(
      params({
        items: [
          {
            sourceWorkflowId: 'wf-src',
            targetWorkflowId: 'wf-tgt',
            mode: 'create',
            sourceMeta: { name: 'New Workflow' },
          },
        ],
        sourceStates: new Map([
          [
            'wf-src',
            stateWith('knowledge', 'Knowledge', {
              knowledgeBaseSelector: { value: 'kb-src' },
              documentSelector: { value: 'doc-src' },
            }),
          ],
        ]),
        sourceLabels: new Map([['knowledge-base:kb-src', 'Docs KB']]),
      })
    )
    expect(result).toEqual([
      {
        targetWorkflowId: 'wf-tgt',
        workflowName: 'New Workflow',
        blockId: targetBlockId,
        blockLabel: 'Knowledge',
        fieldLabel: 'Document',
        kind: 'knowledge-base',
        sourceId: 'kb-src',
        sourceLabel: 'Docs KB',
        cause: 'dependent',
        parentKind: 'knowledge-base',
        parentSourceId: 'kb-src',
      },
    ])
  })
})

const replaceItem = {
  sourceWorkflowId: 'wf-src',
  targetWorkflowId: 'wf-tgt',
  mode: 'replace' as const,
  sourceMeta: { name: 'Caller' },
}

/** Fake executor whose select chains resolve queued row sets in call order. */
function makeExecutor(rowSets: unknown[][] = []) {
  let call = 0
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(rowSets[call++] ?? [])),
    })),
  }))
  return { executor: { select } as unknown as DbOrTx, select }
}

describe('annotateForkClearedRefSourceLiveness', () => {
  beforeEach(() => {
    mockFilterExisting.mockReset()
    mockFilterExisting.mockResolvedValue({})
  })

  const referenceRef = (kind: 'table' | 'knowledge-base', sourceId: string) => ({
    targetWorkflowId: 'wf-tgt',
    workflowName: 'Caller',
    blockId: 'b1',
    blockLabel: 'Block',
    fieldLabel: 'Field',
    kind,
    sourceId,
    sourceLabel: sourceId,
    cause: 'reference' as const,
    sourceDeleted: false,
  })

  it('flags deleted sources and leaves live ones (checked against the SOURCE workspace)', async () => {
    mockFilterExisting.mockResolvedValue({ table: new Set(['tbl-live']) })
    const { executor } = makeExecutor()
    const result = await annotateForkClearedRefSourceLiveness(executor, 'src-ws', [
      referenceRef('table', 'tbl-live'),
      referenceRef('table', 'tbl-gone'),
    ])
    expect(mockFilterExisting).toHaveBeenCalledWith(executor, 'src-ws', {
      table: new Set(['tbl-live', 'tbl-gone']),
    })
    expect(result.map((ref) => (ref.cause === 'reference' ? ref.sourceDeleted : null))).toEqual([
      false,
      true,
    ])
  })
})

describe('collectForkSyncBlockers', () => {
  beforeEach(() => {
    mockFilterExisting.mockReset()
    mockLoadCopyableLabels.mockReset()
    mockFilterExisting.mockResolvedValue({})
    mockLoadCopyableLabels.mockResolvedValue(new Map())
  })

  const baseParams = (overrides: Partial<Parameters<typeof collectForkSyncBlockers>[0]>) => ({
    executor: makeExecutor().executor,
    sourceWorkspaceId: 'src-ws',
    items: [replaceItem],
    sourceStates: new Map<string, WorkflowState>(),
    resolver: (() => null) as ForkReferenceResolver,
    workflowIdMap: new Map<string, string>(),
    resolveBlockId,
    ...overrides,
  })

  it('blocks an unmapped referenced copyable (unmapped-copyable) with its loaded label', async () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([{ id: 'tbl', title: 'Table', type: 'table-selector' }])
    )
    mockFilterExisting.mockResolvedValue({ table: new Set(['tbl-src']) })
    mockLoadCopyableLabels.mockResolvedValue(
      new Map([['table:tbl-src', { label: 'Orders', parentId: null, parentLabel: null }]])
    )
    const { blockers } = await collectForkSyncBlockers(
      baseParams({
        sourceStates: new Map([
          [
            'wf-src',
            stateWith('table', 'Table Block', {
              tbl: { type: 'table-selector', value: 'tbl-src' },
            }),
          ],
        ]),
      })
    )
    expect(blockers).toEqual([
      {
        workflowName: 'Caller',
        blockLabel: 'Table Block',
        fieldLabel: 'Table',
        kind: 'table',
        sourceId: 'tbl-src',
        sourceLabel: 'Orders',
        reason: 'unmapped-copyable',
      },
    ])
  })

  /**
   * The drop hatch. `sourceDeleted` is re-derived here from the source workspace inside the
   * promote transaction, so the acknowledgment is only ever honoured against a reference that is
   * genuinely gone - a crafted payload can never drop a working one.
   */
  it('honours a drop acknowledgment for a source-deleted reference', async () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([{ id: 'kb', title: 'Knowledge Base', type: 'knowledge-base-selector' }])
    )
    mockFilterExisting.mockResolvedValue({ 'knowledge-base': new Set() })
    const { blockers, appliedDrops } = await collectForkSyncBlockers(
      baseParams({
        sourceStates: new Map([
          [
            'wf-src',
            stateWith('knowledge', 'KB Block', {
              kb: { type: 'knowledge-base-selector', value: 'kb-gone' },
            }),
          ],
        ]),
        droppedReferences: [{ kind: 'knowledge-base', sourceId: 'kb-gone' }],
      })
    )
    expect(blockers).toEqual([])
    expect(appliedDrops).toEqual([{ kind: 'knowledge-base', sourceId: 'kb-gone' }])
  })

  it('ignores a drop acknowledgment for a reference whose source is still live', async () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([{ id: 'kb', title: 'Knowledge Base', type: 'knowledge-base-selector' }])
    )
    // The source row still exists, so the reference is an unmapped-copyable, not source-deleted.
    mockFilterExisting.mockResolvedValue({ 'knowledge-base': new Set(['kb-live']) })
    const { blockers, appliedDrops } = await collectForkSyncBlockers(
      baseParams({
        sourceStates: new Map([
          [
            'wf-src',
            stateWith('knowledge', 'KB Block', {
              kb: { type: 'knowledge-base-selector', value: 'kb-live' },
            }),
          ],
        ]),
        droppedReferences: [{ kind: 'knowledge-base', sourceId: 'kb-live' }],
      })
    )
    expect(blockers).toEqual([
      expect.objectContaining({ sourceId: 'kb-live', reason: 'unmapped-copyable' }),
    ])
    expect(appliedDrops).toEqual([])
  })

  it('blocks a source-deleted reference (source-deleted) - no exemption, resolvable by mapping', async () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([{ id: 'kb', title: 'Knowledge Base', type: 'knowledge-base-selector' }])
    )
    // The liveness check reports the source row gone; the copy loader (live rows only) misses,
    // so the label falls back to the id.
    mockFilterExisting.mockResolvedValue({ 'knowledge-base': new Set() })
    const { blockers } = await collectForkSyncBlockers(
      baseParams({
        sourceStates: new Map([
          [
            'wf-src',
            stateWith('knowledge', 'KB Block', {
              kb: { type: 'knowledge-base-selector', value: 'kb-gone' },
            }),
          ],
        ]),
      })
    )
    expect(blockers).toEqual([
      expect.objectContaining({
        kind: 'knowledge-base',
        sourceId: 'kb-gone',
        sourceLabel: 'kb-gone',
        reason: 'source-deleted',
      }),
    ])
    // Mapping the dead id to a live target resolves it (the resolver never checks source
    // liveness - a mapping row whose source row is gone still resolves).
    const { blockers: resolved } = await collectForkSyncBlockers(
      baseParams({
        sourceStates: new Map([
          [
            'wf-src',
            stateWith('knowledge', 'KB Block', {
              kb: { type: 'knowledge-base-selector', value: 'kb-gone' },
            }),
          ],
        ]),
        resolver: (kind, id) => (kind === 'knowledge-base' && id === 'kb-gone' ? 'kb-tgt' : null),
      })
    )
    expect(resolved).toEqual([])
  })

  it('blocks a workflow reference that would clear (workflow-missing), named via the source read', async () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([{ id: 'target', title: 'Workflow', type: 'workflow-selector' }])
    )
    const { executor } = makeExecutor([[{ id: 'wf-child', name: 'Child Flow' }]])
    // The child was deleted in the source: not an item, not in the identity map -> the map
    // built by buildPromoteWorkflowIdMap misses and the reference would clear.
    const workflowIdMap = buildPromoteWorkflowIdMap({
      identityMap: new Map([['wf-child', 'wf-child-tgt']]),
      existingSourceIds: new Set<string>(),
      targetActiveIds: new Set(['wf-child-tgt']),
      items: [{ sourceWorkflowId: 'wf-src', targetWorkflowId: 'wf-tgt' }],
    })
    const { blockers } = await collectForkSyncBlockers(
      baseParams({
        executor,
        sourceStates: new Map([
          [
            'wf-src',
            stateWith('workflow_caller', 'Run Subflow', {
              target: { type: 'workflow-selector', value: 'wf-child' },
            }),
          ],
        ]),
        workflowIdMap,
      })
    )
    expect(blockers).toEqual([
      expect.objectContaining({
        kind: 'workflow',
        sourceId: 'wf-child',
        sourceLabel: 'Child Flow',
        reason: 'workflow-missing',
      }),
    ])
  })

  it('never blocks on dependent-cause entries (create-target dependents stay informational)', async () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        {
          id: 'folder',
          title: 'Label',
          type: 'folder-selector',
          dependsOn: ['credential'],
          selectorKey: 'gmail.labels',
        },
      ])
    )
    const { executor, select } = makeExecutor()
    const { blockers } = await collectForkSyncBlockers(
      baseParams({
        executor,
        items: [{ ...replaceItem, mode: 'create' as const }],
        sourceStates: new Map([
          [
            'wf-src',
            stateWith('gmail', 'Gmail', {
              credential: { value: 'cred-src' },
              folder: { value: 'INBOX' },
            }),
          ],
        ]),
      })
    )
    expect(blockers).toEqual([])
    expect(select).not.toHaveBeenCalled()
    expect(mockFilterExisting).not.toHaveBeenCalled()
  })
})
