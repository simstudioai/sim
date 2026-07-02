/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'

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
} from '@/lib/workspaces/fork/copy/copy-workflows'

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
 * the source folders, the second the target folders, and inserted rows are captured.
 */
function buildFolderTx(sourceFolders: FolderRow[], targetFolders: FolderRow[] = []) {
  const insertedRows: FolderRow[] = []
  const selects = [sourceFolders, targetFolders]
  let selectIndex = 0
  const tx = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(selects[selectIndex++] ?? []),
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

function resolveMapping(params: {
  tx: DbOrTx
  contentFolderIds: ReadonlyArray<string | null>
}): Promise<Map<string, string>> {
  return resolveForkFolderMapping({
    tx: params.tx,
    sourceWorkspaceId: 'ws-source',
    targetWorkspaceId: 'ws-target',
    userId: 'target-user',
    now: new Date('2026-07-01'),
    contentFolderIds: params.contentFolderIds,
  })
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
