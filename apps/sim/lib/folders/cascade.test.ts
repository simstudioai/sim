import { flattenMockConditions, hasMockCondition } from '@sim/testing'
import { describe, expect, it } from 'vitest'
import {
  archiveFolderCascade,
  collectArchivedSubtreeIds,
  collectCascadeSubtreeIds,
  type DbOrTx,
  restoreFolderCascade,
} from '@/lib/folders/cascade'
import { FOLDER_RESOURCES, type FolderResourceConfig } from '@/lib/folders/config'
import { FolderCollectionLimitExceededError } from '@/lib/folders/errors'

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
          const rows = selectQueue.shift() ?? []
          return {
            limit: () => Promise.resolve(rows),
            then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve),
          }
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

const TIMESTAMP = new Date('2026-01-01T00:00:00.000Z')
const NOW = new Date('2026-02-02T00:00:00.000Z')

describe('collectCascadeSubtreeIds', () => {
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
    const clause = flattenMockConditions(selectCalls[0].where).find((node) => node.type === 'or')
    expect(clause).toBeDefined()
    const branches = (clause?.conditions ?? []) as Array<Record<string, unknown>>
    expect(branches.some((node) => node.type === 'isNull')).toBe(true)
    expect(branches.some((node) => node.right === TIMESTAMP)).toBe(true)
  })

  it('fails before materializing an oversized recursive cascade', async () => {
    const { tx } = makeTx({
      selects: [
        [
          { id: 'root', parentId: null },
          { id: 'child', parentId: 'root' },
          { id: 'grandchild', parentId: 'child' },
        ],
      ],
    })

    const rejection = expect(
      collectCascadeSubtreeIds(tx, 'ws-1', 'knowledge_base', 'root', TIMESTAMP, 2)
    ).rejects
    await rejection.toBeInstanceOf(FolderCollectionLimitExceededError)
    await rejection.toMatchObject({
      code: 'payload_too_large',
      message: 'Folder cascade exceeds the 2 row limit',
    })
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
    expect(hasMockCondition(selectCalls[0].where, (node) => node.right === TIMESTAMP)).toBe(true)
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
      hasMockCondition(updateCalls[2].where, (node) => {
        return node.type === 'inArray' && Array.isArray(node.values) && node.values.length === 2
      })
    ).toBe(true)
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
      expect(hasMockCondition(call.where, (node) => node.right === TIMESTAMP)).toBe(true)
    }
  })
})

describe('FOLDER_RESOURCES', () => {
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

  it('guards the delete of resources that gate their own deletion', () => {
    // Tables refuse deletion while delete-locked; deleting the folder around one must not
    // become a way around that control.
    expect(FOLDER_RESOURCES.table.guardDelete).toBeDefined()
  })
})

/**
 * Knowledge bases and tables are the resource trees this cascade newly serves. The generic
 * describes above already exercise both code paths; these pin the per-resource wiring the
 * folder engine depends on, which is exactly what silently drifts.
 */
describe('knowledge_base and table folder resources', () => {
  const knowledgeConfig = FOLDER_RESOURCES.knowledge_base
  const tableConfig = FOLDER_RESOURCES.table

  it('guards folder deletion for locked tables and the shared search index', () => {
    expect(tableConfig.guardDelete).toBeTypeOf('function')
    expect(knowledgeConfig.guardDelete).toBeTypeOf('function')
  })
})
