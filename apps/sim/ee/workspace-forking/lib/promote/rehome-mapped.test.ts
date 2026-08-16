/**
 * @vitest-environment node
 */
import { folder as folderTable, knowledgeBase, workspaceFiles } from '@sim/db/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'
import type { ForkMappingRow } from '@/ee/workspace-forking/lib/mapping/mapping-store'
import { rehomeFlattenedForkResources } from '@/ee/workspace-forking/lib/promote/rehome-mapped'

interface UpdateCall {
  table: unknown
  values: Record<string, unknown>
}

/**
 * Table-dispatched tx mock. Reads are keyed by table (and, for the two-phase folder mapping,
 * by call order: source tree first, then target tree) so a test never has to count queries.
 */
function makeTx(rows: {
  files?: Record<string, unknown>[]
  knowledgeBases?: Record<string, unknown>[]
  sourceFolders?: Record<string, unknown>[]
}) {
  const updates: UpdateCall[] = []
  const insertedFolders: Record<string, unknown>[] = []
  let folderCall = 0
  const tx = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === folderTable) {
            return Promise.resolve(folderCall++ === 0 ? (rows.sourceFolders ?? []) : [])
          }
          if (table === workspaceFiles) return Promise.resolve(rows.files ?? [])
          if (table === knowledgeBase) return Promise.resolve(rows.knowledgeBases ?? [])
          return Promise.resolve([])
        },
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>[]) => {
        insertedFolders.push(...values)
        return Promise.resolve()
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updates.push({ table, values })
          // The real update reports the rows it actually moved; echo one id back so the
          // caller's tally reflects a genuine write rather than the planned batch size.
          return { returning: () => Promise.resolve([{ id: 'moved' }]) }
        },
      }),
    }),
  }
  return { tx: tx as unknown as DbOrTx, updates, insertedFolders }
}

const fileMapping: ForkMappingRow[] = [
  {
    id: 'map-1',
    childWorkspaceId: 'child-ws',
    resourceType: 'file',
    parentResourceId: 'workspace/parent-ws/a.png',
    childResourceId: 'workspace/child-ws/a.png',
  },
]

const kbMapping: ForkMappingRow[] = [
  {
    id: 'map-2',
    childWorkspaceId: 'child-ws',
    resourceType: 'knowledge_base',
    parentResourceId: 'kb-target',
    childResourceId: 'kb-source',
  },
]

const baseParams = {
  mappingRows: [] as ForkMappingRow[],
  sourceWorkspaceId: 'child-ws',
  targetWorkspaceId: 'parent-ws',
  direction: 'push' as const,
  userId: 'user-1',
  now: new Date('2026-08-15T00:00:00.000Z'),
}

describe('rehomeFlattenedForkResources', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('mirrors the source folder and moves a root-flattened mapped file into it', async () => {
    // Push: the child is the source, so the mapping row's child side is the source key.
    const { tx, updates, insertedFolders } = makeTx({
      // Both the target lookup (flattened row) and the source lookup read this table; the
      // rows carry the fields each phase needs.
      files: [
        { id: 'file-target', key: 'workspace/parent-ws/a.png', folderId: null },
        { id: 'file-source', key: 'workspace/child-ws/a.png', folderId: 'src-folder' },
      ],
      sourceFolders: [
        {
          id: 'src-folder',
          name: 'Contracts',
          parentId: null,
          workspaceId: 'child-ws',
          resourceType: 'file',
          deletedAt: null,
        },
      ],
    })

    const result = await rehomeFlattenedForkResources({
      ...baseParams,
      mappingRows: fileMapping,
      tx,
    })

    expect(insertedFolders).toHaveLength(1)
    expect(insertedFolders[0]).toMatchObject({
      name: 'Contracts',
      workspaceId: 'parent-ws',
      resourceType: 'file',
    })
    const newFolderId = insertedFolders[0].id as string
    expect(updates).toHaveLength(1)
    expect(updates[0].table).toBe(workspaceFiles)
    expect(updates[0].values).toEqual({ folderId: newFolderId })
    expect(result.rehomed.file).toBe(1)
    expect(result.folderIdMap.get('src-folder')).toBe(newFolderId)
  })

  it('leaves a resource alone when the source itself sits at the root', async () => {
    const { tx, updates, insertedFolders } = makeTx({
      files: [
        { id: 'file-target', key: 'workspace/parent-ws/a.png', folderId: null },
        { id: 'file-source', key: 'workspace/child-ws/a.png', folderId: null },
      ],
    })

    const result = await rehomeFlattenedForkResources({
      ...baseParams,
      mappingRows: fileMapping,
      tx,
    })

    expect(insertedFolders).toHaveLength(0)
    expect(updates).toHaveLength(0)
    expect(result.rehomed.file).toBe(0)
  })

  it('never touches a target already placed in a folder, so a deliberate move survives a re-sync', async () => {
    // The target read filters on `folderId IS NULL`, so an already-placed row is simply absent.
    const { tx, updates } = makeTx({
      knowledgeBases: [],
      sourceFolders: [
        {
          id: 'src-folder',
          name: 'Policies',
          parentId: null,
          workspaceId: 'child-ws',
          resourceType: 'knowledge_base',
          deletedAt: null,
        },
      ],
    })

    const result = await rehomeFlattenedForkResources({
      ...baseParams,
      mappingRows: kbMapping,
      tx,
    })

    expect(updates).toHaveLength(0)
    expect(result.rehomed.knowledge_base).toBe(0)
  })

  it('no-ops entirely when the edge has no mapped resources', async () => {
    const { tx, updates, insertedFolders } = makeTx({})

    const result = await rehomeFlattenedForkResources({ ...baseParams, tx })

    expect(updates).toHaveLength(0)
    expect(insertedFolders).toHaveLength(0)
    expect(result.rehomed).toEqual({ file: 0, table: 0, knowledge_base: 0 })
  })

  it('orients pull the other way: the parent side is the source', async () => {
    const { tx, updates } = makeTx({
      files: [
        // On a pull the CHILD is the target, so its key is the one that must still be flattened.
        { id: 'file-target', key: 'workspace/child-ws/a.png', folderId: null },
        { id: 'file-source', key: 'workspace/parent-ws/a.png', folderId: 'src-folder' },
      ],
      sourceFolders: [
        {
          id: 'src-folder',
          name: 'Contracts',
          parentId: null,
          workspaceId: 'parent-ws',
          resourceType: 'file',
          deletedAt: null,
        },
      ],
    })

    const result = await rehomeFlattenedForkResources({
      ...baseParams,
      mappingRows: fileMapping,
      tx,
      direction: 'pull',
      sourceWorkspaceId: 'parent-ws',
      targetWorkspaceId: 'child-ws',
    })

    expect(updates).toHaveLength(1)
    expect(result.rehomed.file).toBe(1)
  })
})
