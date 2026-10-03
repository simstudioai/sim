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
 * Pins the `"<name> (N)"` shape the client and migration 0272 also produce (see `naming.ts`).
 * Every caller mocks this module out, so nothing else in the suite covers it.
 */
describe('deduplicateFolderName', () => {
  it('starts the suffix at (1), not (2)', async () => {
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

  /**
   * The sibling query defines the namespace the suffix is chosen within, and must match the
   * scope of the partial unique index — workspace, resourceType, parent, active-only. Drop any
   * clause and it counts the wrong rows, inflating the suffix or picking a taken name.
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

    it('excludes soft-deleted siblings so an archived name is reusable', async () => {
      // The unique index is partial (WHERE deleted_at IS NULL), so counting archived siblings
      // would suffix a name that is actually free.
      const { tx, selectCalls } = makeTx([])

      await deduplicateFolderName(tx, 'ws-1', null, 'Reports', 'workflow')

      // Two isNull nodes: the root parent scope and the soft-delete filter.
      expect(
        flattenMockConditions(selectCalls[0].where).filter((n) => n.type === 'isNull')
      ).toHaveLength(2)
    })
  })
})
