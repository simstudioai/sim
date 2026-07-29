/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  archiveFolderCascade,
  collectArchivedSubtreeIds,
  collectCascadeSubtreeIds,
  type DbOrTx,
  restoreFolderCascade,
  restoreFolderRows,
  toCascadeCounts,
} from '@/lib/folders/cascade'
import { FOLDER_RESOURCES, type FolderResourceConfig } from '@/lib/folders/config'
import { folderMutationStatus } from '@/lib/folders/status'

interface SelectCall {
  where: unknown
}

interface UpdateCall {
  table: unknown
  set: Record<string, unknown>
  where: unknown
}

/**
 * Chainable stand-in for a drizzle handle. Select chains are awaited after `.where()`;
 * update chains after `.returning()`. Results are dequeued in call order, so a test states
 * exactly what each successive statement sees.
 */
function makeTx(options: { selects?: unknown[][]; updates?: unknown[][] } = {}) {
  const selectQueue = [...(options.selects ?? [])]
  const updateQueue = [...(options.updates ?? [])]
  const selectCalls: SelectCall[] = []
  const updateCalls: UpdateCall[] = []

  const tx = {
    select: () => ({
      from: () => ({
        where: (where: unknown) => {
          selectCalls.push({ where })
          return Promise.resolve(selectQueue.shift() ?? [])
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: unknown) => {
          const rows = updateQueue.shift() ?? []
          const call: UpdateCall = { table, set, where }
          updateCalls.push(call)
          return {
            returning: () => Promise.resolve(rows),
            then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve),
          }
        },
      }),
    }),
  }

  return { tx: tx as unknown as DbOrTx, selectCalls, updateCalls }
}

const CHILD_TABLE = { name: 'child_table' }
const DEPENDENT_TABLE = { name: 'dependent_table' }

function makeConfig(overrides: Partial<FolderResourceConfig> = {}): FolderResourceConfig {
  return {
    resourceType: 'table',
    label: 'table',
    countKey: 'tables',
    table: CHILD_TABLE as never,
    idColumn: 'child.id' as never,
    folderIdColumn: 'child.folderId' as never,
    workspaceColumn: 'child.workspaceId' as never,
    deletedColumn: 'child.archivedAt' as never,
    deletedKey: 'archivedAt',
    buildSoftDeleteSet: (timestamp, now) => ({ archivedAt: timestamp, updatedAt: now }),
    ...overrides,
  }
}

/** Flattens the nested `and(...)` objects the drizzle operator mocks produce. */
function flattenConditions(condition: unknown): Array<Record<string, unknown>> {
  if (!condition || typeof condition !== 'object') return []
  const node = condition as Record<string, unknown>
  if (node.type === 'and' && Array.isArray(node.conditions)) {
    return node.conditions.flatMap(flattenConditions)
  }
  return [node]
}

function hasCondition(
  condition: unknown,
  predicate: (node: Record<string, unknown>) => boolean
): boolean {
  return flattenConditions(condition).some(predicate)
}

const TIMESTAMP = new Date('2026-01-01T00:00:00.000Z')
const NOW = new Date('2026-02-02T00:00:00.000Z')

describe('collectCascadeSubtreeIds', () => {
  it('returns the folder plus every descendant in the cascade', async () => {
    const { tx, selectCalls } = makeTx({
      selects: [
        [
          { id: 'root', parentId: null },
          { id: 'child', parentId: 'root' },
          { id: 'grandchild', parentId: 'child' },
          { id: 'unrelated', parentId: null },
        ],
      ],
    })

    const ids = await collectCascadeSubtreeIds(tx, 'ws-1', 'table', 'root', TIMESTAMP)

    expect(ids).toEqual(['root', 'child', 'grandchild'])
    expect(selectCalls).toHaveLength(1)
  })

  it('admits folders already stamped by this cascade so a retry reaches nested stragglers', async () => {
    // The cascade stamps folders before children, so a failure during the child pass leaves
    // intermediate folders archived. An active-only walk would drop `child` here and never
    // reach the resources still live under it.
    const { tx, selectCalls } = makeTx({
      selects: [
        [
          { id: 'root', parentId: null },
          { id: 'child', parentId: 'root' },
          { id: 'grandchild', parentId: 'child' },
        ],
      ],
    })

    const ids = await collectCascadeSubtreeIds(tx, 'ws-1', 'table', 'root', TIMESTAMP)

    expect(ids).toEqual(['root', 'child', 'grandchild'])
    // Either still active, or carrying this cascade's own stamp — never another snapshot's.
    const clause = flattenConditions(selectCalls[0].where).find((node) => node.type === 'or')
    expect(clause).toBeDefined()
    const branches = (clause?.conditions ?? []) as Array<Record<string, unknown>>
    expect(branches.some((node) => node.type === 'isNull')).toBe(true)
    expect(branches.some((node) => node.right === TIMESTAMP)).toBe(true)
  })

  it('scopes the walk to the workspace and resourceType', async () => {
    const { tx, selectCalls } = makeTx({ selects: [[]] })

    await collectCascadeSubtreeIds(tx, 'ws-1', 'knowledge_base', 'root', TIMESTAMP)

    expect(hasCondition(selectCalls[0].where, (node) => node.right === 'knowledge_base')).toBe(true)
    expect(hasCondition(selectCalls[0].where, (node) => node.right === 'ws-1')).toBe(true)
  })
})

describe('collectArchivedSubtreeIds', () => {
  it('matches on the exact cascade timestamp so unrelated archived folders stay archived', async () => {
    const { tx, selectCalls } = makeTx({
      selects: [
        [
          { id: 'root', parentId: null },
          { id: 'child', parentId: 'root' },
        ],
      ],
    })

    const ids = await collectArchivedSubtreeIds(tx, 'ws-1', 'table', 'root', TIMESTAMP)

    expect(ids).toEqual(['root', 'child'])
    expect(hasCondition(selectCalls[0].where, (node) => node.right === TIMESTAMP)).toBe(true)
  })

  it('terminates on a parent cycle instead of recursing forever', async () => {
    const { tx } = makeTx({
      selects: [
        [
          { id: 'a', parentId: 'b' },
          { id: 'b', parentId: 'a' },
        ],
      ],
    })

    const ids = await collectArchivedSubtreeIds(tx, 'ws-1', 'table', 'a', TIMESTAMP)

    expect(ids).toEqual(['a', 'b'])
  })
})

describe('archiveFolderCascade', () => {
  it('stamps folders before children, under one shared timestamp', async () => {
    const { tx, updateCalls } = makeTx({
      updates: [
        [{ id: 'root' }, { id: 'sub' }],
        [{ id: 'child-1' }, { id: 'child-2' }],
      ],
    })

    const counts = await archiveFolderCascade(tx, makeConfig(), 'ws-1', ['root', 'sub'], TIMESTAMP)

    expect(counts).toEqual({ folders: 2, children: 2 })
    expect(updateCalls).toHaveLength(2)
    // Order is load-bearing: the folder must carry the stamp before any child does, so a
    // failed cascade can be retried onto the same snapshot instead of minting a new one.
    expect(updateCalls[0].table).not.toBe(CHILD_TABLE)
    expect(updateCalls[0].set).toMatchObject({ deletedAt: TIMESTAMP })
    expect(updateCalls[1].table).toBe(CHILD_TABLE)
    expect(updateCalls[1].set).toEqual({ archivedAt: TIMESTAMP, updatedAt: TIMESTAMP })
  })

  it('stamps the folder before invoking an archiveChildren hook', async () => {
    const seenAtHookTime: number[] = []
    const { tx, updateCalls } = makeTx({ updates: [[{ id: 'root' }]] })
    const archiveChildren = vi.fn().mockImplementation(async () => {
      seenAtHookTime.push(updateCalls.length)
      return 3
    })

    await archiveFolderCascade(tx, makeConfig({ archiveChildren }), 'ws-1', ['root'], TIMESTAMP)

    // The hook walks resources one at a time and can fail partway, so the folder stamp must
    // already be in place by then for the retry to reuse it.
    expect(seenAtHookTime).toEqual([1])
  })

  it('skips rows that were already soft-deleted independently', async () => {
    const { tx, updateCalls } = makeTx({ updates: [[], []] })

    await archiveFolderCascade(tx, makeConfig(), 'ws-1', ['root'], TIMESTAMP)

    for (const call of updateCalls) {
      expect(hasCondition(call.where, (node) => node.type === 'isNull')).toBe(true)
    }
  })

  it('stamps every row with the timestamp it is given, not one of its own', async () => {
    const { tx, updateCalls } = makeTx({ updates: [[{ id: 'root' }], [{ id: 'child-1' }]] })

    await archiveFolderCascade(tx, makeConfig(), 'ws-1', ['root'], TIMESTAMP)

    // Regression guard: deleting an already-archived folder reuses that folder's existing
    // deletedAt. A fresh stamp here would strand the children — the folder row keeps its
    // original stamp, so restore would never match them.
    expect(updateCalls[0].set).toMatchObject({ deletedAt: TIMESTAMP })
    expect(updateCalls[1].set).toEqual({ archivedAt: TIMESTAMP, updatedAt: TIMESTAMP })
  })

  it('delegates to archiveChildren when a resource archives through its own lifecycle', async () => {
    const archiveChildren = vi.fn().mockResolvedValue(7)
    const { tx, updateCalls } = makeTx({ updates: [[{ id: 'root' }]] })

    const counts = await archiveFolderCascade(
      tx,
      makeConfig({ archiveChildren }),
      'ws-1',
      ['root', 'sub'],
      TIMESTAMP
    )

    expect(archiveChildren).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      folderIds: ['root', 'sub'],
      timestamp: TIMESTAMP,
    })
    expect(counts).toEqual({ folders: 1, children: 7 })
    // Only the folder table is touched directly — the hook owns the child writes.
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].table).not.toBe(CHILD_TABLE)
  })
})

describe('restoreFolderCascade', () => {
  const dependents = [
    {
      table: DEPENDENT_TABLE as never,
      childIdColumn: 'dependent.childId' as never,
      deletedColumn: 'dependent.archivedAt' as never,
      buildRestoreSet: (now: Date) => ({ archivedAt: null, updatedAt: now }),
    },
  ]

  it('restores folders, children, and dependents matching the cascade timestamp', async () => {
    const { tx, updateCalls } = makeTx({
      updates: [[{ id: 'root' }, { id: 'sub' }], [{ id: 'child-1' }, { id: 'child-2' }], []],
    })

    const counts = await restoreFolderCascade(
      tx,
      makeConfig({ restoreDependents: dependents }),
      'ws-1',
      ['root', 'sub'],
      TIMESTAMP,
      NOW
    )

    expect(counts).toEqual({ folders: 2, children: 2 })
    expect(updateCalls).toHaveLength(3)
    expect(updateCalls[1].set).toEqual({ archivedAt: null, updatedAt: NOW })
    expect(updateCalls[2].table).toBe(DEPENDENT_TABLE)
    expect(
      hasCondition(updateCalls[2].where, (node) => {
        return node.type === 'inArray' && Array.isArray(node.values) && node.values.length === 2
      })
    ).toBe(true)
  })

  it('issues a fixed number of statements regardless of subtree depth', async () => {
    const deepSubtree = ['a', 'b', 'c', 'd', 'e', 'f']
    const { tx, updateCalls } = makeTx({
      updates: [deepSubtree.map((id) => ({ id })), [{ id: 'child-1' }], []],
    })

    await restoreFolderCascade(
      tx,
      makeConfig({ restoreDependents: dependents }),
      'ws-1',
      deepSubtree,
      TIMESTAMP,
      NOW
    )

    // One UPDATE for folders, one for children, one per dependent table — never per folder.
    expect(updateCalls).toHaveLength(2 + dependents.length)
  })

  it('skips dependent writes when nothing was restored', async () => {
    const { tx, updateCalls } = makeTx({ updates: [[{ id: 'root' }], []] })

    const counts = await restoreFolderCascade(
      tx,
      makeConfig({ restoreDependents: dependents }),
      'ws-1',
      ['root'],
      TIMESTAMP,
      NOW
    )

    expect(counts).toEqual({ folders: 1, children: 0 })
    expect(updateCalls).toHaveLength(2)
  })

  it('restores only rows carrying the folder’s own soft-delete timestamp', async () => {
    const { tx, updateCalls } = makeTx({ updates: [[{ id: 'root' }], [{ id: 'child-1' }], []] })

    await restoreFolderCascade(
      tx,
      makeConfig({ restoreDependents: dependents }),
      'ws-1',
      ['root'],
      TIMESTAMP,
      NOW
    )

    for (const call of updateCalls) {
      expect(hasCondition(call.where, (node) => node.right === TIMESTAMP)).toBe(true)
    }
  })
})

describe('restoreFolderRows', () => {
  it('restores only folders carrying the cascade timestamp', async () => {
    const { tx, updateCalls } = makeTx({ updates: [[{ id: 'root' }, { id: 'sub' }]] })

    const folders = await restoreFolderRows(
      tx,
      makeConfig(),
      'ws-1',
      ['root', 'sub'],
      TIMESTAMP,
      NOW
    )

    expect(folders).toBe(2)
    expect(updateCalls).toHaveLength(1)
    expect(hasCondition(updateCalls[0].where, (node) => node.right === TIMESTAMP)).toBe(true)
  })
})

describe('folderMutationStatus', () => {
  it('maps a locked resource to 423, matching the single-resource delete', () => {
    expect(folderMutationStatus('locked')).toBe(423)
  })

  it('maps the shared orchestration codes', () => {
    expect(folderMutationStatus('validation')).toBe(400)
    expect(folderMutationStatus('not_found')).toBe(404)
    expect(folderMutationStatus('conflict')).toBe(409)
    expect(folderMutationStatus('internal')).toBe(500)
    expect(folderMutationStatus(undefined)).toBe(500)
  })
})

describe('toCascadeCounts', () => {
  it('reports the child count under the resource’s own key', () => {
    expect(toCascadeCounts(makeConfig(), { folders: 2, children: 3 })).toEqual({
      folders: 2,
      tables: 3,
    })
    expect(
      toCascadeCounts(makeConfig({ countKey: 'knowledgeBases' }), { folders: 1, children: 0 })
    ).toEqual({ folders: 1, knowledgeBases: 0 })
  })
})

describe('FOLDER_RESOURCES', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pairs every archiveChildren hook with a restoreChildren hook', () => {
    // An archive hook exists because archiving touches more than the child row. Without the
    // matching restore hook, a folder restore would revive the resource and strand whatever
    // the archive hook took down with it.
    for (const config of Object.values(FOLDER_RESOURCES)) {
      if (!config.archiveChildren) continue
      const hasRestorePath = Boolean(config.restoreChildren) || Boolean(config.restoreDependents)
      expect(hasRestorePath).toBe(true)
    }
  })

  it('grants lock semantics to workflows only', () => {
    // `folder.locked` predates the generic table and is deliberately not extended. Anything
    // that flips a second resource to lockable has to add the UI and authz to match.
    const lockable = Object.values(FOLDER_RESOURCES)
      .filter((config) => config.supportsLocking)
      .map((config) => config.resourceType)
    expect(lockable).toEqual(['workflow'])
  })

  it('guards the delete of resources that gate their own deletion', () => {
    // Tables refuse deletion while delete-locked; deleting the folder around one must not
    // become a way around that control.
    expect(FOLDER_RESOURCES.table.guardDelete).toBeDefined()
  })

  it('declares one entry per folder resource type', () => {
    expect(Object.keys(FOLDER_RESOURCES).sort()).toEqual([
      'file',
      'knowledge_base',
      'table',
      'workflow',
    ])
  })

  it('keys every entry consistently with its own resourceType', () => {
    for (const [key, config] of Object.entries(FOLDER_RESOURCES)) {
      expect(config.resourceType).toBe(key)
    }
  })

  it('gives every resource a distinct cascade count key', () => {
    const countKeys = Object.values(FOLDER_RESOURCES).map((config) => config.countKey)
    expect(new Set(countKeys).size).toBe(countKeys.length)
  })

  it('builds soft-delete payloads that write the declared soft-delete property', () => {
    for (const config of Object.values(FOLDER_RESOURCES)) {
      const archiveSet = config.buildSoftDeleteSet(TIMESTAMP, NOW)
      const restoreSet = config.buildSoftDeleteSet(null, NOW)
      expect(archiveSet[config.deletedKey]).toBe(TIMESTAMP)
      expect(restoreSet[config.deletedKey]).toBeNull()
    }
  })

  it('restores dependents to an active state', () => {
    for (const config of Object.values(FOLDER_RESOURCES)) {
      for (const dependent of config.restoreDependents ?? []) {
        expect(Object.values(dependent.buildRestoreSet(NOW))).toContain(null)
      }
    }
  })
})
