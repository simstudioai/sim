/**
 * @vitest-environment node
 */
import { flattenMockConditions, hasMockCondition } from '@sim/testing'
import { describe, expect, it } from 'vitest'
import { deduplicateFolderName } from '@/lib/folders/naming'

interface SelectCall {
  where: unknown
}

/**
 * Chainable stand-in for the injectable `tx`. `deduplicateFolderName` awaits after `.where()`,
 * so the sibling rows are returned there and the condition captured for inspection.
 */
function makeTx(siblingNames: string[]) {
  const selectCalls: SelectCall[] = []
  const tx = {
    select: () => ({
      from: () => ({
        where: (where: unknown) => {
          selectCalls.push({ where })
          return Promise.resolve(siblingNames.map((name) => ({ name })))
        },
      }),
    }),
  }
  return { tx: tx as never, selectCalls }
}

/**
 * The suffix shape is a cross-surface contract: the client's `nextUntitledFolderName` and
 * migration 0272's backfill both produce `"<name> (N)"` starting at (1). A server-side drift
 * either collides on `folder_workspace_resource_parent_name_active_unique` (23505 on a path the
 * user cannot retry) or renders a folder named differently depending on how it was created.
 * Nothing asserted this before — every caller mocks this module out.
 */
describe('deduplicateFolderName', () => {
  it('returns the requested name untouched when no sibling holds it', async () => {
    const { tx } = makeTx(['Other', 'Reports (1)'])

    expect(await deduplicateFolderName(tx, 'ws-1', null, 'Reports', 'workflow')).toBe('Reports')
  })

  it('starts the suffix at (1), not (2)', async () => {
    // A loop seeded at 2 — the shape of a bug already fixed twice in this feature — yields
    // "Reports (2)" here and silently diverges from the client and the migration.
    const { tx } = makeTx(['Reports'])

    expect(await deduplicateFolderName(tx, 'ws-1', null, 'Reports', 'workflow')).toBe('Reports (1)')
  })

  it('skips suffixes already taken rather than returning a colliding name', async () => {
    const { tx } = makeTx(['Reports', 'Reports (1)', 'Reports (2)'])

    expect(await deduplicateFolderName(tx, 'ws-1', null, 'Reports', 'workflow')).toBe('Reports (3)')
  })

  it('fills a gap in the suffix sequence instead of appending past it', async () => {
    const { tx } = makeTx(['Reports', 'Reports (2)'])

    expect(await deduplicateFolderName(tx, 'ws-1', null, 'Reports', 'workflow')).toBe('Reports (1)')
  })

  it('treats a name that only differs by suffix as a distinct base', async () => {
    // 'Reports (1)' is taken, but the request is for 'Reports (1)' itself — its first free
    // variant is 'Reports (1) (1)', not 'Reports (2)'.
    const { tx } = makeTx(['Reports (1)'])

    expect(await deduplicateFolderName(tx, 'ws-1', null, 'Reports (1)', 'workflow')).toBe(
      'Reports (1) (1)'
    )
  })

  /**
   * The sibling query defines the namespace the suffix is chosen within. Every clause below
   * mirrors one column of the partial unique index — dropping any of them counts the wrong rows
   * and either inflates the suffix or picks a name that is already taken.
   */
  describe('sibling scoping', () => {
    it('scopes to workspace, resourceType, root parent, and active rows', async () => {
      const { tx, selectCalls } = makeTx([])

      await deduplicateFolderName(tx, 'ws-1', null, 'Reports', 'knowledge_base')

      expect(selectCalls).toHaveLength(1)
      const { where } = selectCalls[0]
      expect(hasMockCondition(where, (n) => n.type === 'eq' && n.right === 'ws-1')).toBe(true)
      // Without this a knowledge-base folder would count table folders as siblings.
      expect(hasMockCondition(where, (n) => n.type === 'eq' && n.right === 'knowledge_base')).toBe(
        true
      )
      // Root scope must be IS NULL, not eq(null), which matches nothing in SQL.
      expect(hasMockCondition(where, (n) => n.type === 'isNull')).toBe(true)
    })

    it('scopes to the given parent when nested', async () => {
      const { tx, selectCalls } = makeTx([])

      await deduplicateFolderName(tx, 'ws-1', 'parent-1', 'Reports', 'workflow')

      expect(
        hasMockCondition(selectCalls[0].where, (n) => n.type === 'eq' && n.right === 'parent-1')
      ).toBe(true)
    })

    it('excludes soft-deleted siblings so an archived name is reusable', async () => {
      // The unique index is partial (WHERE deleted_at IS NULL), so counting archived siblings
      // would suffix a name that is actually free.
      const { tx, selectCalls } = makeTx([])

      await deduplicateFolderName(tx, 'ws-1', null, 'Reports', 'workflow')

      expect(
        flattenMockConditions(selectCalls[0].where).filter((n) => n.type === 'isNull')
      ).toHaveLength(2)
    })
  })
})
