/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { FolderCollectionFullError } from '@/lib/folders/errors'

const { mockSaveWorkflowToNormalizedTables } = vi.hoisted(() => ({
  mockSaveWorkflowToNormalizedTables: vi.fn(),
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  saveWorkflowToNormalizedTables: mockSaveWorkflowToNormalizedTables,
}))

import {
  buildWorkflowNameRegistry,
  copyWorkflowStateIntoTarget,
  resolveForkFolderMapping,
} from '@/ee/workspace-forking/lib/copy/copy-workflows'

describe('buildWorkflowNameRegistry', () => {
  it('reports a name as taken by another workflow in the same folder', () => {
    const reg = buildWorkflowNameRegistry([{ id: 'w1', folderId: 'f1', name: 'Onboarding' }])
    expect(reg.isTaken('f1', 'Onboarding', null)).toBe(true)
    expect(reg.isTaken('f1', 'Onboarding', 'w2')).toBe(true)
  })

  it('excludes the workflow itself so a replace can keep its own name', () => {
    const reg = buildWorkflowNameRegistry([{ id: 'w1', folderId: 'f1', name: 'Onboarding' }])
    expect(reg.isTaken('f1', 'Onboarding', 'w1')).toBe(false)
  })

  it('is folder-scoped: the same name in another folder is free', () => {
    const reg = buildWorkflowNameRegistry([{ id: 'w1', folderId: 'f1', name: 'Onboarding' }])
    expect(reg.isTaken('f2', 'Onboarding', null)).toBe(false)
    expect(reg.isTaken(null, 'Onboarding', null)).toBe(false)
  })

  it('treats the root (null) folder distinctly, matching coalesce(folderId, "")', () => {
    const reg = buildWorkflowNameRegistry([{ id: 'w1', folderId: null, name: 'Root WF' }])
    expect(reg.isTaken(null, 'Root WF', null)).toBe(true)
    expect(reg.isTaken('f1', 'Root WF', null)).toBe(false)
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

  it('re-claiming the same (folder, name) is a no-op', () => {
    const reg = buildWorkflowNameRegistry([{ id: 'w1', folderId: 'f1', name: 'Same' }])
    reg.claim('f1', 'Same', 'w1')
    expect(reg.isTaken('f1', 'Same', 'w1')).toBe(false)
    expect(reg.isTaken('f1', 'Same', null)).toBe(true)
  })

  it('handles multiple holders (legacy duplicates) and partial release', () => {
    const reg = buildWorkflowNameRegistry([
      { id: 'w1', folderId: 'f1', name: 'Dup' },
      { id: 'w2', folderId: 'f1', name: 'Dup' },
    ])
    expect(reg.isTaken('f1', 'Dup', 'w1')).toBe(true)
    reg.claim('f1', 'Other', 'w2')
    expect(reg.isTaken('f1', 'Dup', 'w1')).toBe(false)
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

  it('prunes a root-level empty folder when the copied workflows live at root', async () => {
    const { tx, insertedRows } = buildFolderTx([folderRow('F', 'Never used')])

    const map = await resolveMapping({ tx, contentFolderIds: [null, null] })

    expect(insertedRows).toHaveLength(0)
    expect(map.size).toBe(0)
  })

  it('creates no folders when nothing is copied into any folder', async () => {
    const { tx, insertedRows } = buildFolderTx([
      folderRow('A', 'Alpha'),
      folderRow('B', 'Beta', 'A'),
    ])

    const map = await resolveMapping({ tx, contentFolderIds: [] })

    expect(insertedRows).toHaveLength(0)
    expect(map.size).toBe(0)
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

  it('maps a pruned folder onto a matching existing target folder without creating it', async () => {
    const existing = { ...folderRow('T1', 'Prior sync'), workspaceId: 'ws-target' }
    const { tx, insertedRows } = buildFolderTx([folderRow('P', 'Prior sync')], [existing])

    const map = await resolveMapping({ tx, contentFolderIds: [] })

    expect(insertedRows).toHaveLength(0)
    expect(map.get('P')).toBe('T1')
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

  it('creates a kept child under a reused existing parent folder', async () => {
    const existingParent = { ...folderRow('T-parent', 'Parent'), workspaceId: 'ws-target' }
    const { tx, insertedRows } = buildFolderTx(
      [folderRow('P', 'Parent'), folderRow('C', 'Child', 'P')],
      [existingParent]
    )

    const map = await resolveMapping({ tx, contentFolderIds: ['C'] })

    expect(map.get('P')).toBe('T-parent')
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0].name).toBe('Child')
    expect(insertedRows[0].parentId).toBe('T-parent')
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

  it('allows a fork whose new folders exactly fill the target workspace ceiling', async () => {
    const { tx, insertedRows } = buildFolderTx(
      [folderRow('A', 'Alpha'), folderRow('B', 'Beta', 'A'), folderRow('C', 'Gamma', 'B')],
      [],
      MAX_FOLDERS_PER_WORKSPACE - 3
    )

    await resolveMapping({ tx, contentFolderIds: ['C'] })

    expect(insertedRows).toHaveLength(3)
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

describe('copyWorkflowStateIntoTarget folder fallback', () => {
  it('places a copied workflow at the target root when its source folder has no mapping', async () => {
    mockSaveWorkflowToNormalizedTables.mockResolvedValue({ success: true })
    const insertedWorkflows: Array<Record<string, unknown>> = []
    const tx = {
      insert: () => ({
        values: (row: Record<string, unknown>) => {
          insertedWorkflows.push(row)
          return Promise.resolve()
        },
      }),
    } as unknown as DbOrTx

    const result = await copyWorkflowStateIntoTarget({
      tx,
      targetWorkflowId: 'wf-child',
      targetWorkspaceId: 'ws-target',
      userId: 'target-user',
      mode: 'create',
      now: new Date('2026-07-01'),
      sourceState: { blocks: {}, edges: [], loops: {}, parallels: {}, variables: {} },
      sourceMeta: {
        name: 'Orphaned placement',
        description: null,
        folderId: 'folder-with-no-mapping',
        sortOrder: 0,
      },
      workflowIdMap: new Map(),
      folderIdMap: new Map(),
      nameRegistry: buildWorkflowNameRegistry([]),
    })

    expect(insertedWorkflows).toHaveLength(1)
    expect(insertedWorkflows[0].folderId).toBeNull()
    expect(result.name).toBe('Orphaned placement')
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

  /**
   * The adoption case: the arriving trigger has a different target block id (re-created in the
   * source), and the resolver handed it the URL retiring in the same target workflow.
   */
  it('writes an ADOPTED path onto a trigger block that serves no webhook of its own', async () => {
    mockSaveWorkflowToNormalizedTables.mockResolvedValue({ success: true })
    await copyWorkflowStateIntoTarget({
      ...baseParams,
      tx: stubTx(),
      triggerPathByBlockId: new Map([['tgt-blk-src', 'retiring-slack-path']]),
    })
    expect(writtenSubBlocks().triggerPath?.value).toBe('retiring-slack-path')
  })

  it('leaves the path unset when the target block serves no webhook yet (derives as before)', async () => {
    mockSaveWorkflowToNormalizedTables.mockResolvedValue({ success: true })
    await copyWorkflowStateIntoTarget({ ...baseParams, tx: stubTx() })
    expect(writtenSubBlocks().triggerPath).toBeUndefined()
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

  it('repoints the placed block at the mapped target type', async () => {
    // The push symptom was read as "it still has the old custom block" — but both
    // environments' blocks share a NAME, so a successful rewrite looks identical on the
    // canvas. Pin the type itself rather than trusting the visual.
    mockSaveWorkflowToNormalizedTables.mockResolvedValue({ success: true })

    await copyWorkflowStateIntoTarget({
      ...baseParams,
      tx: stubTx(),
      transformBlockType: (type) => (type === UAT ? PROD : type),
    })

    expect(writtenBlock().type).toBe(PROD)
  })

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

  it('writes the inputs configured for the target block', async () => {
    mockSaveWorkflowToNormalizedTables.mockResolvedValue({ success: true })

    await copyWorkflowStateIntoTarget({
      ...baseParams,
      tx: stubTx(),
      transformBlockType: (type) => (type === UAT ? PROD : type),
      dependentOverrides: new Map([
        ['tgt-blk-cb', new Map([[`${PROD}::string::field-prod-x`, 'prod value X']])],
      ]),
    })

    const subBlocks = writtenBlock().subBlocks ?? {}
    expect(subBlocks['field-prod-x']?.value).toBe('prod value X')
    // No value migrated across the swap — two custom blocks are independent workflows.
    expect(subBlocks['field-uat-a']).toBeUndefined()
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

  it('leaves inputs untouched when the type does NOT change', async () => {
    // Identity mapping, or no mapping at all: the field ids still describe this same block,
    // so the values carry exactly like a regular block's.
    mockSaveWorkflowToNormalizedTables.mockResolvedValue({ success: true })

    await copyWorkflowStateIntoTarget({
      ...baseParams,
      tx: stubTx(),
      transformBlockType: (type) => type,
      dependentOverrides: new Map([
        ['tgt-blk-cb', new Map([[`${PROD}::string::field-prod-x`, 'must not apply']])],
      ]),
    })

    const subBlocks = writtenBlock().subBlocks ?? {}
    expect(writtenBlock().type).toBe(UAT)
    expect(subBlocks['field-uat-a']?.value).toBe('uat value A')
    expect(subBlocks['field-prod-x']).toBeUndefined()
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

  it('leaves an unset boolean unset rather than writing false', async () => {
    // The modal submits '' for an untouched optional flag. Coercing that to `false` writes a
    // value the user never chose: `assembleCustomBlockInputMapping` skips '' but keeps
    // `false`, so it would reach the child's inputMapping and override the Start field's own
    // default. Only an explicit 'false' means false.
    mockSaveWorkflowToNormalizedTables.mockResolvedValue({ success: true })

    await copyWorkflowStateIntoTarget({
      ...baseParams,
      tx: stubTx(),
      transformBlockType: (type) => (type === UAT ? PROD : type),
      dependentOverrides: new Map([
        [
          'tgt-blk-cb',
          new Map([
            [`${PROD}::boolean::untouched`, ''],
            [`${PROD}::boolean::explicit-false`, 'false'],
          ]),
        ],
      ]),
    })

    const subBlocks = writtenBlock().subBlocks ?? {}
    expect(subBlocks).not.toHaveProperty('untouched')
    expect(subBlocks['explicit-false']?.value).toBe(false)
  })
})
