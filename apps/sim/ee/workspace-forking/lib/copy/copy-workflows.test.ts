import { createBlock } from '@sim/testing/factories'
import {
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
} from '@sim/testing/mocks/workflows-persistence-utils.mock'
import { describe, expect, it, vi } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { FolderCollectionFullError } from '@/lib/folders/errors'
import { createForkSubBlockTransform } from '@/lib/workflows/references/remap-references'
import { getBlock } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)

import {
  buildWorkflowNameRegistry,
  copyWorkflowStateIntoTarget,
  resolveForkFolderMapping,
} from '@/ee/workspace-forking/lib/copy/copy-workflows'

const mockSaveWorkflowToNormalizedTables =
  workflowsPersistenceUtilsMockFns.mockSaveWorkflowToNormalizedTables

describe('buildWorkflowNameRegistry', () => {
  it('excludes the workflow itself so a replace can keep its own name', () => {
    const reg = buildWorkflowNameRegistry([{ id: 'w1', folderId: 'f1', name: 'Onboarding' }])
    expect(reg.isTaken('f1', 'Onboarding', 'w1')).toBe(false)
  })

  it('claims a new name so a later workflow in the same copy loop sees it taken', () => {
    const reg = buildWorkflowNameRegistry([])
    expect(reg.isTaken('f1', 'Report', null)).toBe(false)
    reg.claim('f1', 'Report', 'wA')
    expect(reg.isTaken('f1', 'Report', null)).toBe(true)
    expect(reg.isTaken('f1', 'Report', 'wA')).toBe(false)
  })

  it('releases the prior name when a workflow is renamed (claim moves keys)', () => {
    const reg = buildWorkflowNameRegistry([{ id: 'w1', folderId: 'f1', name: 'Old' }])
    reg.claim('f1', 'New', 'w1')
    expect(reg.isTaken('f1', 'Old', null)).toBe(false)
    expect(reg.isTaken('f1', 'New', null)).toBe(true)
  })
})

interface FolderRow {
  id: string
  name: string
  userId: string
  workspaceId: string
  parentId: string | null
  color: string | null
  isExpanded: boolean
  locked: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
  archivedAt: Date | null
}

function folderRow(id: string, name: string, parentId: string | null = null): FolderRow {
  return {
    id,
    name,
    userId: 'source-user',
    workspaceId: 'ws-source',
    parentId,
    color: '#6B7280',
    isExpanded: true,
    locked: false,
    sortOrder: 0,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    archivedAt: null,
  }
}

/**
 * Transaction stub for {@link resolveForkFolderMapping}: the first awaited select resolves
 * the source folders, the second the target folders, the third the target's active folder
 * count (the ceiling check, which only runs when the copy has folders to insert), and
 * inserted rows are captured.
 */
function buildFolderTx(
  sourceFolders: FolderRow[],
  targetFolders: FolderRow[] = [],
  targetFolderCount = 0
) {
  const insertedRows: FolderRow[] = []
  const selects: unknown[][] = [sourceFolders, targetFolders, [{ total: targetFolderCount }]]
  let selectIndex = 0
  const tx = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve((selects[selectIndex++] ?? []) as FolderRow[]),
      }),
    }),
    insert: () => ({
      values: (rows: FolderRow[]) => {
        insertedRows.push(...rows)
        return Promise.resolve()
      },
    }),
  } as unknown as DbOrTx
  return { tx, insertedRows }
}

async function resolveMapping(params: {
  tx: DbOrTx
  contentFolderIds: ReadonlyArray<string | null>
}): Promise<Map<string, string>> {
  const { folderIdMap } = await resolveForkFolderMapping({
    tx: params.tx,
    sourceWorkspaceId: 'ws-source',
    targetWorkspaceId: 'ws-target',
    userId: 'target-user',
    now: new Date('2026-07-01'),
    resourceType: 'workflow',
    contentFolderIds: params.contentFolderIds,
  })
  return folderIdMap
}

describe('resolveForkFolderMapping', () => {
  it('keeps the full ancestor chain of a nested folder holding a copied workflow', async () => {
    const { tx, insertedRows } = buildFolderTx([
      folderRow('A', 'Alpha'),
      folderRow('B', 'Beta', 'A'),
      folderRow('C', 'Gamma', 'B'),
    ])

    const map = await resolveMapping({ tx, contentFolderIds: ['C'] })

    expect(map.size).toBe(3)
    expect(insertedRows).toHaveLength(3)
    const byName = new Map(insertedRows.map((row) => [row.name, row]))
    expect(byName.get('Alpha')?.parentId).toBeNull()
    expect(byName.get('Beta')?.parentId).toBe(map.get('A'))
    expect(byName.get('Gamma')?.parentId).toBe(map.get('B'))
    for (const row of insertedRows) {
      expect(row.workspaceId).toBe('ws-target')
      expect(row.userId).toBe('target-user')
      expect(row.locked).toBe(false)
      expect(['A', 'B', 'C']).not.toContain(row.id)
    }
  })

  it('prunes an empty sibling subtree while keeping the occupied folder', async () => {
    const { tx, insertedRows } = buildFolderTx([
      folderRow('A', 'Occupied'),
      folderRow('D', 'Empty parent'),
      folderRow('E', 'Empty child', 'D'),
    ])

    const map = await resolveMapping({ tx, contentFolderIds: ['A'] })

    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0].name).toBe('Occupied')
    expect(map.has('A')).toBe(true)
    expect(map.has('D')).toBe(false)
    expect(map.has('E')).toBe(false)
  })

  it('mirrors an empty folder selected by canonical path and returns its path mapping', async () => {
    const { tx, insertedRows } = buildFolderTx([
      folderRow('A', 'Reports'),
      folderRow('B', 'Empty', 'A'),
    ])

    const result = await resolveForkFolderMapping({
      tx,
      sourceWorkspaceId: 'ws-source',
      targetWorkspaceId: 'ws-target',
      userId: 'target-user',
      now: new Date('2026-07-01'),
      resourceType: 'workflow',
      contentFolderIds: [],
      contentFolderPaths: ['/Reports/Empty'],
    })

    expect(insertedRows.map((row) => row.name)).toEqual(['Reports', 'Empty'])
    expect(result.folderPathMap).toEqual(new Map([['/Reports/Empty', '/Reports/Empty']]))
  })

  it('reuses an existing target folder for a kept folder instead of duplicating it', async () => {
    const existing = { ...folderRow('T1', 'Shared'), workspaceId: 'ws-target' }
    const { tx, insertedRows } = buildFolderTx([folderRow('G', 'Shared')], [existing])

    const map = await resolveMapping({ tx, contentFolderIds: ['G'] })

    expect(insertedRows).toHaveLength(0)
    expect(map.get('G')).toBe('T1')
  })

  it('never root-aliases a pruned nested folder onto a same-named root target folder', async () => {
    // Source X is nested under unmatched P; the target's root-level "X" is unrelated.
    const existing = { ...folderRow('T-root-x', 'X'), workspaceId: 'ws-target' }
    const { tx, insertedRows } = buildFolderTx(
      [folderRow('P', 'Parent'), folderRow('X', 'X', 'P')],
      [existing]
    )

    const map = await resolveMapping({ tx, contentFolderIds: [] })

    expect(insertedRows).toHaveLength(0)
    expect(map.size).toBe(0)
  })

  /**
   * The fork mirrors a whole source subtree into the target in one bulk insert, so it can
   * push the target past `MAX_FOLDERS_PER_WORKSPACE` — the ceiling every capped folder
   * reader materializes under — and leave the target's folder list unreadable. The refusal
   * is raised before the insert and inside the fork transaction, so the copy rolls back.
   */
  it('refuses a fork whose new folders would cross the target workspace ceiling', async () => {
    const { tx, insertedRows } = buildFolderTx(
      [folderRow('A', 'Alpha'), folderRow('B', 'Beta', 'A'), folderRow('C', 'Gamma', 'B')],
      [],
      MAX_FOLDERS_PER_WORKSPACE - 2
    )

    const rejection = expect(resolveMapping({ tx, contentFolderIds: ['C'] })).rejects
    await rejection.toBeInstanceOf(FolderCollectionFullError)
    await rejection.toMatchObject({ code: 'conflict' })
    expect(insertedRows).toHaveLength(0)
  })

  /**
   * A sync that reuses every target folder adds no rows, so an already-over-cap target must
   * not have it refused — the ceiling gates writes, never reads.
   */
  it('does not refuse a sync into an over-cap target when it creates no folders', async () => {
    const existing = { ...folderRow('T1', 'Shared'), workspaceId: 'ws-target' }
    const { tx, insertedRows } = buildFolderTx(
      [folderRow('G', 'Shared')],
      [existing],
      MAX_FOLDERS_PER_WORKSPACE + 5
    )

    const map = await resolveMapping({ tx, contentFolderIds: ['G'] })

    expect(insertedRows).toHaveLength(0)
    expect(map.get('G')).toBe('T1')
  })
})

describe('copyWorkflowStateIntoTarget source tool identities', () => {
  it.each([false, true])(
    'applies source-indexed choices before pruning optional tools (serialized=%s)',
    async (serialized) => {
      const tools = [
        { type: 'custom-tool', customToolId: 'deleted-custom-tool' },
        { type: 'workflow_input', params: { workflowId: 'uncopied-workflow' } },
        {
          type: 'mcp',
          title: 'First',
          params: { serverId: 'source-server', toolName: 'old-first' },
        },
        {
          type: 'mcp',
          title: 'Second',
          params: { serverId: 'source-server', toolName: 'old-second' },
        },
      ]
      const sourceState: WorkflowState = {
        blocks: {
          agent: {
            id: 'agent',
            type: 'agent',
            name: 'Agent',
            enabled: true,
            position: { x: 0, y: 0 },
            outputs: {},
            subBlocks: {
              tools: {
                id: 'tools',
                type: 'tool-input',
                value: serialized ? JSON.stringify(tools) : tools,
              },
            },
            data: { canonicalModes: { '2:credential': 'advanced' } },
          },
        },
        edges: [],
        loops: {},
        parallels: {},
        variables: {},
      }
      const config = { subBlocks: [{ id: 'tools', type: 'tool-input' }] } as BlockConfig
      await vi.mocked(getBlock).withImplementation(
        (type) => (type === 'agent' ? config : undefined),
        async () => {
          mockSaveWorkflowToNormalizedTables.mockResolvedValue({ success: true })
          await copyWorkflowStateIntoTarget({
            tx: { insert: () => ({ values: () => Promise.resolve() }) } as unknown as DbOrTx,
            targetWorkflowId: 'wf-child',
            targetWorkspaceId: 'ws-child',
            userId: 'user',
            mode: 'create',
            now: new Date('2026-09-09'),
            sourceState,
            sourceMeta: { name: 'Agent mapping', description: null, folderId: null, sortOrder: 0 },
            workflowIdMap: new Map([['wf-source', 'wf-child']]),
            folderIdMap: new Map(),
            nameRegistry: buildWorkflowNameRegistry([]),
            resolveBlockId: () => 'target-agent',
            transformSubBlocks: createForkSubBlockTransform((kind) =>
              kind === 'mcp-server' ? 'target-server' : null
            ),
            dependentOverrides: new Map([
              [
                'target-agent',
                new Map([
                  ['tools[2].toolName', 'chosen-first'],
                  ['tools[3].toolName', 'chosen-second'],
                ]),
              ],
            ]),
          })
        }
      )
      const saved = mockSaveWorkflowToNormalizedTables.mock.calls.at(-1)![1] as WorkflowState
      const value = saved.blocks['target-agent'].subBlocks.tools.value
      const copied = typeof value === 'string' ? JSON.parse(value) : value
      expect(copied).toEqual([
        expect.objectContaining({
          title: 'First',
          params: { serverId: 'target-server', toolName: 'chosen-first' },
        }),
        expect.objectContaining({
          title: 'Second',
          params: { serverId: 'target-server', toolName: 'chosen-second' },
        }),
      ])
      expect(saved.blocks['target-agent'].data?.canonicalModes).toEqual({
        '0:credential': 'advanced',
      })
      expect(sourceState.blocks.agent.subBlocks.tools.value).toEqual(
        serialized ? JSON.stringify(tools) : tools
      )
    }
  )
})

describe('copied MCP configuration normalization', () => {
  it('normalizes an explicit connection before resource remapping and persistence', async () => {
    mockSaveWorkflowToNormalizedTables.mockResolvedValue({ success: true })
    const source = createBlock({
      id: 'mcp',
      type: 'mcp',
      subBlocks: {
        server: { id: 'server', type: 'mcp-server-selector', value: 'canonical-parent' },
        connection: { id: 'connection', type: 'mcp-server-selector', value: 'explicit-connection' },
        operation: { id: 'operation', type: 'dropdown', value: 'run' },
        tool: { id: 'tool', type: 'mcp-tool-selector', value: 'read' },
      },
    })
    await copyWorkflowStateIntoTarget({
      tx: { insert: () => ({ values: () => Promise.resolve() }) } as unknown as DbOrTx,
      targetWorkflowId: 'wf-child',
      targetWorkspaceId: 'ws-target',
      userId: 'target-user',
      mode: 'create',
      now: new Date('2026-07-01'),
      sourceState: { blocks: { mcp: source }, edges: [], loops: {}, parallels: {}, variables: {} },
      sourceMeta: { name: 'MCP', description: null, folderId: null, sortOrder: 0 },
      workflowIdMap: new Map(),
      folderIdMap: new Map(),
      nameRegistry: buildWorkflowNameRegistry([]),
      transformSubBlocks: (subBlocks, _type, modes) => {
        expect(subBlocks.serverSelector.value).toBe('explicit-connection')
        expect(subBlocks.connection).toBeUndefined()
        expect(subBlocks.server).toBeUndefined()
        expect(modes).toEqual({ server: 'basic', tool: 'basic' })
        return { ...subBlocks, serverSelector: { ...subBlocks.serverSelector, value: '' } }
      },
    })
    const [, state] = mockSaveWorkflowToNormalizedTables.mock.calls.at(-1)!
    const persisted = Object.values(state.blocks)[0] as {
      subBlocks: Record<string, { value: unknown }>
      data: { canonicalModes: unknown }
    }
    expect(persisted.subBlocks.serverSelector.value).toBe('')
    expect(persisted.subBlocks.server).toBeUndefined()
    expect(persisted.subBlocks.connection).toBeUndefined()
    expect(persisted.data.canonicalModes).toEqual({ server: 'basic', tool: 'basic' })
  })
})

describe('copyWorkflowStateIntoTarget canonicalModes reindex propagation', () => {
  it(
    "persists a transform's reindexed canonicalModes on the copied block, and uses that " +
      "SAME reindexed value (not the source's stale one) for every subsequent remap step",
    async () => {
      mockSaveWorkflowToNormalizedTables.mockResolvedValue({ success: true })
      const seenCanonicalModes: Array<Record<string, 'basic' | 'advanced'> | undefined> = []
      const tx = {
        insert: () => ({ values: () => Promise.resolve() }),
      } as unknown as DbOrTx

      await copyWorkflowStateIntoTarget({
        tx,
        targetWorkflowId: 'wf-child',
        targetWorkspaceId: 'ws-target',
        userId: 'target-user',
        mode: 'create',
        now: new Date('2026-07-01'),
        sourceState: {
          blocks: {
            block1: {
              id: 'block1',
              type: 'agent',
              name: 'Agent',
              subBlocks: {},
              // The source's ORIGINAL (pre-drop) canonicalModes - every step after the
              // transform must see the REINDEXED value below instead, not this one.
              data: { canonicalModes: { '1:credential': 'advanced' } },
            },
          },
          edges: [],
          loops: {},
          parallels: {},
          variables: {},
        },
        sourceMeta: { name: 'Reindex test', description: null, folderId: null, sortOrder: 0 },
        workflowIdMap: new Map(),
        folderIdMap: new Map(),
        nameRegistry: buildWorkflowNameRegistry([]),
        // Simulates a `tool-input` drop shifting tool 1 -> 0: returns subBlocks unchanged but
        // reports the reindexed canonicalModes via the callback, exactly like
        // `createForkBootstrapTransform`/`createForkSubBlockTransform` do.
        transformSubBlocks: (subBlocks, _blockType, canonicalModes, onCanonicalModesChanged) => {
          seenCanonicalModes.push(canonicalModes)
          onCanonicalModesChanged?.({ '0:credential': 'advanced' })
          return subBlocks
        },
      })

      const [, remappedState] = mockSaveWorkflowToNormalizedTables.mock.calls.at(-1)!
      const persistedBlock = Object.values(remappedState.blocks)[0] as {
        data?: { canonicalModes?: Record<string, 'basic' | 'advanced'> }
      }
      // The transform received the source's original value...
      expect(seenCanonicalModes).toEqual([{ '1:credential': 'advanced' }])
      // ...and the PERSISTED block carries the reindexed one, not the stale source value.
      expect(persistedBlock.data?.canonicalModes).toEqual({ '0:credential': 'advanced' })
    }
  )
})

describe('copyWorkflowStateIntoTarget webhook path pinning', () => {
  const sourceState = {
    blocks: {
      'blk-src': {
        id: 'blk-src',
        type: 'slack',
        name: 'Slack',
        // The SOURCE's own path, written back into its draft after its deploy. Copying it would
        // point the target at the source's URL, so the sanitizer strips it.
        subBlocks: { triggerPath: { id: 'triggerPath', type: 'short-input', value: 'src-path' } },
        outputs: {},
        enabled: true,
      },
    },
    edges: [],
    loops: {},
    parallels: {},
    variables: {},
  } as never

  const baseParams = {
    targetWorkflowId: 'wf-tgt',
    targetWorkspaceId: 'ws-target',
    userId: 'target-user',
    mode: 'replace' as const,
    now: new Date('2026-07-01'),
    sourceState,
    sourceMeta: { name: 'Prod', description: null, folderId: null, sortOrder: 0 },
    workflowIdMap: new Map(),
    folderIdMap: new Map(),
    nameRegistry: buildWorkflowNameRegistry([]),
    resolveBlockId: (_targetWorkflowId: string, sourceBlockId: string) => `tgt-${sourceBlockId}`,
  }

  /** `replace` mode updates the existing target workflow row; stub just that chain. */
  const stubTx = () =>
    ({
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    }) as unknown as DbOrTx

  function writtenSubBlocks() {
    const state = mockSaveWorkflowToNormalizedTables.mock.calls.at(-1)?.[1] as {
      blocks: Record<string, { subBlocks?: Record<string, { value?: unknown }> }>
    }
    return state.blocks['tgt-blk-src'].subBlocks ?? {}
  }

  it("pins the TARGET's live webhook path so a sync never moves a URL already in the wild", async () => {
    mockSaveWorkflowToNormalizedTables.mockResolvedValue({ success: true })
    await copyWorkflowStateIntoTarget({
      ...baseParams,
      tx: stubTx(),
      triggerPathByBlockId: new Map([['tgt-blk-src', 'parent-live-path']]),
    })
    expect(writtenSubBlocks().triggerPath?.value).toBe('parent-live-path')
  })
})

describe('copyWorkflowStateIntoTarget custom-block remap', () => {
  const PROD = 'custom_block_prod01'
  const UAT = 'custom_block_uat0001'

  /** A placed custom block whose inputs are keyed by the SOURCE block's Start field ids. */
  const customBlockState = {
    blocks: {
      'blk-cb': {
        id: 'blk-cb',
        type: UAT,
        name: 'Invoice Parser',
        position: { x: 0, y: 0 },
        subBlocks: {
          workflowId: { id: 'workflowId', type: 'short-input', value: 'wf-uat' },
          'field-uat-a': { id: 'field-uat-a', type: 'short-input', value: 'uat value A' },
          'field-uat-b': { id: 'field-uat-b', type: 'short-input', value: 'uat value B' },
        },
        outputs: {},
        enabled: true,
      },
    },
    edges: [],
    loops: {},
    parallels: {},
    variables: {},
  } as never

  const baseParams = {
    targetWorkflowId: 'wf-tgt',
    targetWorkspaceId: 'ws-parent',
    userId: 'u1',
    mode: 'replace' as const,
    now: new Date('2026-07-01'),
    sourceState: customBlockState,
    sourceMeta: { name: 'Orchestrator', description: null, folderId: null, sortOrder: 0 },
    workflowIdMap: new Map(),
    folderIdMap: new Map(),
    nameRegistry: buildWorkflowNameRegistry([]),
    resolveBlockId: (_t: string, sourceBlockId: string) => `tgt-${sourceBlockId}`,
  }

  const stubTx = () =>
    ({ update: () => ({ set: () => ({ where: () => Promise.resolve() }) }) }) as unknown as DbOrTx

  function writtenBlock() {
    const state = mockSaveWorkflowToNormalizedTables.mock.calls.at(-1)?.[1] as {
      blocks: Record<string, { type: string; subBlocks?: Record<string, { value?: unknown }> }>
    }
    return state.blocks['tgt-blk-cb']
  }

  it('drops the source-keyed inputs when the type changes, instead of leaving them to rot', async () => {
    // Left in place they survive the copy and are then dropped SILENTLY by the serializer
    // (a stored value with no matching config is a deleted input), which is what made a
    // synced block render with its name and no fields.
    mockSaveWorkflowToNormalizedTables.mockResolvedValue({ success: true })

    await copyWorkflowStateIntoTarget({
      ...baseParams,
      tx: stubTx(),
      transformBlockType: (type) => (type === UAT ? PROD : type),
    })

    const subBlocks = writtenBlock().subBlocks ?? {}
    expect(subBlocks['field-uat-a']).toBeUndefined()
    expect(subBlocks['field-uat-b']).toBeUndefined()
  })

  it('preserves reserved wiring across the swap', async () => {
    // `workflowId`/`inputMapping` are computed value-fns the serializer recomputes; dropping
    // them here would be harmless but replacing them with a stale literal would not be.
    mockSaveWorkflowToNormalizedTables.mockResolvedValue({ success: true })

    await copyWorkflowStateIntoTarget({
      ...baseParams,
      tx: stubTx(),
      transformBlockType: (type) => (type === UAT ? PROD : type),
      dependentOverrides: new Map([
        [
          'tgt-blk-cb',
          new Map([
            [`${PROD}::string::workflowId`, 'crafted'],
            [`${PROD}::string::field-prod-x`, 'ok'],
          ]),
        ],
      ]),
    })

    const subBlocks = writtenBlock().subBlocks ?? {}
    expect(subBlocks.workflowId?.value).toBe('wf-uat')
    expect(subBlocks['field-prod-x']?.value).toBe('ok')
  })

  it('ignores values stored for a DIFFERENT target, so a second remap starts clean', async () => {
    // Map to A, configure it, then remap to B. A field id present on both would otherwise
    // carry A's value into B — a different workflow's field that happens to share a name.
    mockSaveWorkflowToNormalizedTables.mockResolvedValue({ success: true })
    const OTHER = 'custom_block_other99'

    await copyWorkflowStateIntoTarget({
      ...baseParams,
      tx: stubTx(),
      transformBlockType: (type) => (type === UAT ? PROD : type),
      dependentOverrides: new Map([
        [
          'tgt-blk-cb',
          new Map([
            [`${OTHER}::string::shared-field`, 'value from the previous target'],
            [`${PROD}::string::shared-field`, 'value for this target'],
          ]),
        ],
      ]),
    })

    expect(writtenBlock().subBlocks?.['shared-field']?.value).toBe('value for this target')
  })

  it('restores a boolean input as a real boolean, not the string it was stored as', async () => {
    // The dependent store holds strings, but a boolean field's sub-block is a `switch` and the
    // canvas stores it as a boolean — `'false'` left as text is truthy to the child workflow.
    mockSaveWorkflowToNormalizedTables.mockResolvedValue({ success: true })

    await copyWorkflowStateIntoTarget({
      ...baseParams,
      tx: stubTx(),
      transformBlockType: (type) => (type === UAT ? PROD : type),
      dependentOverrides: new Map([
        [
          'tgt-blk-cb',
          new Map([
            [`${PROD}::boolean::flag-on`, 'true'],
            [`${PROD}::boolean::flag-off`, 'false'],
            [`${PROD}::string::text`, 'true'],
          ]),
        ],
      ]),
    })

    const subBlocks = writtenBlock().subBlocks ?? {}
    expect(subBlocks['flag-on']?.value).toBe(true)
    expect(subBlocks['flag-off']?.value).toBe(false)
    // A string field whose value happens to read "true" stays a string.
    expect(subBlocks.text?.value).toBe('true')
  })
})

describe('copyWorkflowStateIntoTarget fork-sync inheritance', () => {
  const sourceState = {
    blocks: {},
    edges: [],
    loops: {},
    parallels: {},
    variables: {},
  } as never

  /** `create` mode inserts the target row; capture exactly what it writes. */
  function stubCreateTx(captured: Record<string, unknown>[]) {
    return {
      insert: () => ({
        values: (row: Record<string, unknown>) => {
          captured.push(row)
          return Promise.resolve()
        },
      }),
    } as unknown as DbOrTx
  }

  const createParams = (forkSyncExcluded: boolean) => ({
    targetWorkflowId: 'wf-new',
    targetWorkspaceId: 'ws-target',
    userId: 'target-user',
    mode: 'create' as const,
    now: new Date('2026-07-01'),
    sourceState,
    sourceMeta: {
      name: 'Prod',
      description: null,
      folderId: null,
      sortOrder: 0,
      forkSyncExcluded,
    },
    workflowIdMap: new Map(),
    folderIdMap: new Map(),
    nameRegistry: buildWorkflowNameRegistry([]),
    resolveBlockId: (_targetWorkflowId: string, sourceBlockId: string) => `tgt-${sourceBlockId}`,
  })

  /**
   * The regression the whole opt-in feature hinges on. A copy is the same logical workflow
   * in another workspace, so it must inherit the SOURCE's participation - never the target
   * workspace's new-workflow default. In an opt-in workspace the default is "excluded", so
   * taking it here would land an explicitly-selected source's copy already excluded and
   * sync would never update it again.
   */
  it('inherits a synced source so the copy keeps syncing', async () => {
    const rows: Record<string, unknown>[] = []
    await copyWorkflowStateIntoTarget({ ...createParams(false), tx: stubCreateTx(rows) } as never)
    expect(rows[0].forkSyncExcluded).toBe(false)
  })

  it('inherits an unsynced source so an overridden copy does not start syncing back', async () => {
    const rows: Record<string, unknown>[] = []
    await copyWorkflowStateIntoTarget({ ...createParams(true), tx: stubCreateTx(rows) } as never)
    expect(rows[0].forkSyncExcluded).toBe(true)
  })

  /**
   * The field is required on the contract precisely so this can never be omitted: a copy
   * that fell through to the column default would silently ATTACH itself to sync in an
   * opt-in lineage, with no UI or audit signal.
   */
  it('always writes the column, never falling through to the DB default', async () => {
    const rows: Record<string, unknown>[] = []
    await copyWorkflowStateIntoTarget({ ...createParams(false), tx: stubCreateTx(rows) } as never)
    expect('forkSyncExcluded' in rows[0]).toBe(true)
  })
})
