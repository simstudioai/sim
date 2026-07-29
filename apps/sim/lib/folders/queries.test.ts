/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  findActiveFolder,
  listFoldersForWorkspace,
  resolveRestoredFolderId,
  toFolderApi,
  wouldCreateFolderCycle,
} from '@/lib/folders/queries'

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

/** The condition passed to the Nth `.where()` of this test. */
function whereAt(index: number): unknown {
  return dbChainMockFns.where.mock.calls[index]?.[0]
}

const ROW = {
  id: 'f-1',
  resourceType: 'workflow' as const,
  name: 'Reports',
  userId: 'u-1',
  workspaceId: 'ws-1',
  parentId: null,
  locked: false,
  sortOrder: 0,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  deletedAt: null,
}

describe('folder queries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  /**
   * These are the id-keyed lookups. Every other query in the feature is already scoped by
   * workspace + resourceType through a list filter, but these accept a caller-supplied id — so
   * they are the one place a missing `resource_type` clause silently crosses resource trees,
   * filing a knowledge base under a table folder where no page will ever render it. Nothing
   * asserted this before: every caller mocks this module out, so deleting the clause left the
   * whole suite green.
   */
  describe('findActiveFolder', () => {
    it('scopes by id, workspace, resourceType, and active state', async () => {
      queueTableRows(schemaMock.folder, [ROW])

      await findActiveFolder('f-1', 'ws-1', 'knowledge_base')

      const where = whereAt(0)
      expect(hasCondition(where, (n) => n.type === 'eq' && n.right === 'f-1')).toBe(true)
      expect(hasCondition(where, (n) => n.type === 'eq' && n.right === 'ws-1')).toBe(true)
      expect(hasCondition(where, (n) => n.type === 'eq' && n.right === 'knowledge_base')).toBe(true)
      // Archived folders are not valid destinations — a row filed under one is unreachable.
      expect(hasCondition(where, (n) => n.type === 'isNull')).toBe(true)
    })

    it('returns null when no row matches', async () => {
      queueTableRows(schemaMock.folder, [])

      expect(await findActiveFolder('f-1', 'ws-1', 'workflow')).toBeNull()
    })
  })

  describe('wouldCreateFolderCycle', () => {
    it('detects the immediate self-parent case without querying', async () => {
      expect(await wouldCreateFolderCycle('f-1', 'f-1', 'workflow')).toBe(true)
      expect(dbChainMockFns.where).not.toHaveBeenCalled()
    })

    it('scopes every step of the upward walk to resourceType', async () => {
      // Without the clause the walk can leave this resource's tree via a caller-supplied
      // parent id and report "no cycle" from another tree's ancestry.
      queueTableRows(schemaMock.folder, [{ parentId: 'grandparent' }])
      queueTableRows(schemaMock.folder, [{ parentId: null }])

      await wouldCreateFolderCycle('f-1', 'parent-1', 'table')

      expect(dbChainMockFns.where.mock.calls.length).toBeGreaterThanOrEqual(2)
      for (const [where] of dbChainMockFns.where.mock.calls) {
        expect(hasCondition(where, (n) => n.type === 'eq' && n.right === 'table')).toBe(true)
      }
    })

    it('reports a cycle when the walk reaches the folder being reparented', async () => {
      queueTableRows(schemaMock.folder, [{ parentId: 'f-1' }])

      expect(await wouldCreateFolderCycle('f-1', 'parent-1', 'workflow')).toBe(true)
    })

    it('terminates on a pre-existing cycle above the folder', async () => {
      // `visited` is what stops this looping forever; optimistic client reparents can write one.
      queueTableRows(schemaMock.folder, [{ parentId: 'b' }])
      queueTableRows(schemaMock.folder, [{ parentId: 'a' }])

      expect(await wouldCreateFolderCycle('f-1', 'a', 'workflow')).toBe(true)
    })

    it('returns false when the walk reaches the root', async () => {
      queueTableRows(schemaMock.folder, [{ parentId: null }])

      expect(await wouldCreateFolderCycle('f-1', 'parent-1', 'workflow')).toBe(false)
    })
  })

  /**
   * The `restoringFolderIds` short-circuit is load-bearing for cascade ordering: `restoreFolder`
   * runs its `restoreChildren` hook BEFORE un-archiving the folder rows, so a plain "is my folder
   * active?" check sees them still archived and dumps the entire subtree at the workspace root.
   */
  describe('resolveRestoredFolderId', () => {
    it('keeps the folder without querying when it is in the restoring set', async () => {
      const result = await resolveRestoredFolderId('f-1', 'ws-1', 'workflow', new Set(['f-1']))

      expect(result).toBe('f-1')
      expect(dbChainMockFns.where).not.toHaveBeenCalled()
    })

    it('re-roots to null when the original folder is not active', async () => {
      queueTableRows(schemaMock.folder, [])

      expect(await resolveRestoredFolderId('f-1', 'ws-1', 'workflow')).toBeNull()
    })

    it('keeps the folder when it is still active outside a cascade', async () => {
      queueTableRows(schemaMock.folder, [ROW])

      expect(await resolveRestoredFolderId('f-1', 'ws-1', 'workflow')).toBe('f-1')
    })

    it('re-roots when the resource has no folder or no workspace', async () => {
      expect(await resolveRestoredFolderId(null, 'ws-1', 'workflow')).toBeNull()
      expect(await resolveRestoredFolderId('f-1', null, 'workflow')).toBeNull()
      expect(dbChainMockFns.where).not.toHaveBeenCalled()
    })
  })

  describe('listFoldersForWorkspace', () => {
    it('scopes to workspace and resourceType, and to active rows by default', async () => {
      queueTableRows(schemaMock.folder, [ROW])

      await listFoldersForWorkspace('ws-1', 'active', 'table')

      const where = whereAt(0)
      expect(hasCondition(where, (n) => n.type === 'eq' && n.right === 'ws-1')).toBe(true)
      expect(hasCondition(where, (n) => n.type === 'eq' && n.right === 'table')).toBe(true)
      expect(hasCondition(where, (n) => n.type === 'isNull')).toBe(true)
      expect(hasCondition(where, (n) => n.type === 'isNotNull')).toBe(false)
    })

    it('inverts the soft-delete filter for the archived scope', async () => {
      queueTableRows(schemaMock.folder, [])

      await listFoldersForWorkspace('ws-1', 'archived', 'workflow')

      const where = whereAt(0)
      expect(hasCondition(where, (n) => n.type === 'isNotNull')).toBe(true)
      expect(hasCondition(where, (n) => n.type === 'isNull')).toBe(false)
    })
  })

  /**
   * `requestJson` validates responses against the contract, so a route returning a raw row fails
   * client-side parse AFTER its write has already committed. This normalizer is the single point
   * that keeps every folder route emitting the same wire shape.
   */
  describe('toFolderApi', () => {
    it('serializes timestamps to ISO strings and preserves a null deletedAt', () => {
      expect(toFolderApi(ROW)).toMatchObject({
        id: 'f-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        deletedAt: null,
      })
    })

    it('serializes a present deletedAt rather than dropping it', () => {
      const deleted = { ...ROW, deletedAt: new Date('2026-03-03T00:00:00.000Z') }

      expect(toFolderApi(deleted).deletedAt).toBe('2026-03-03T00:00:00.000Z')
    })
  })
})
