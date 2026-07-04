/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  parsePostgrestFilter,
  parsePostgrestOrder,
  predicateToPostgrest,
  sortSpecToPostgrestOrder,
} from '@/lib/table/query-builder/postgrest'
import type { ColumnDefinition, TablePredicate } from '@/lib/table/types'

const COLS: ColumnDefinition[] = [
  { name: 'wins', type: 'number' },
  { name: 'status', type: 'string' },
  { name: 'active', type: 'boolean' },
  { name: 'name', type: 'string' },
  { name: 'slack_user_id', type: 'string' },
]

describe('parsePostgrestFilter', () => {
  it('parses top-level params as an AND of leaves, coercing by column type', () => {
    expect(parsePostgrestFilter('wins=gte.10&status=eq.active', COLS)).toEqual({
      all: [
        { field: 'wins', op: 'gte', value: 10 },
        { field: 'status', op: 'eq', value: 'active' },
      ],
    })
  })

  it('coerces booleans and numbers', () => {
    expect(parsePostgrestFilter('active=eq.true&wins=eq.5', COLS)).toEqual({
      all: [
        { field: 'active', op: 'eq', value: true },
        { field: 'wins', op: 'eq', value: 5 },
      ],
    })
  })

  it('parses in.(...) lists with per-element coercion', () => {
    expect(parsePostgrestFilter('slack_user_id=in.(U1,U2)', COLS)).toEqual({
      all: [{ field: 'slack_user_id', op: 'in', value: ['U1', 'U2'] }],
    })
    expect(parsePostgrestFilter('wins=in.(1,2,3)', COLS)).toEqual({
      all: [{ field: 'wins', op: 'in', value: [1, 2, 3] }],
    })
  })

  it('maps neq→ne, is.null→isNull, not.is.null→isNotNull', () => {
    expect(parsePostgrestFilter('status=neq.x', COLS)).toEqual({
      all: [{ field: 'status', op: 'ne', value: 'x' }],
    })
    expect(parsePostgrestFilter('status=is.null', COLS)).toEqual({
      all: [{ field: 'status', op: 'isNull' }],
    })
    expect(parsePostgrestFilter('status=not.is.null', COLS)).toEqual({
      all: [{ field: 'status', op: 'isNotNull' }],
    })
  })

  it('supports not.eq → ne and not.in → nin', () => {
    expect(parsePostgrestFilter('status=not.eq.x', COLS)).toEqual({
      all: [{ field: 'status', op: 'ne', value: 'x' }],
    })
    expect(parsePostgrestFilter('slack_user_id=not.in.(U1,U2)', COLS)).toEqual({
      all: [{ field: 'slack_user_id', op: 'nin', value: ['U1', 'U2'] }],
    })
  })

  it('keeps like/ilike/match values as raw text (wildcards/regex preserved)', () => {
    expect(parsePostgrestFilter('name=ilike.*jo*', COLS)).toEqual({
      all: [{ field: 'name', op: 'ilike', value: '*jo*' }],
    })
    expect(parsePostgrestFilter('name=match.^a.*z$', COLS)).toEqual({
      all: [{ field: 'name', op: 'match', value: '^a.*z$' }],
    })
  })

  it('parses or=(...) and nested and()/or() groups', () => {
    expect(parsePostgrestFilter('or=(status.eq.active,status.eq.pending)', COLS)).toEqual({
      all: [
        {
          any: [
            { field: 'status', op: 'eq', value: 'active' },
            { field: 'status', op: 'eq', value: 'pending' },
          ],
        },
      ],
    })
    const nested = parsePostgrestFilter('and=(wins.gte.1,or(status.eq.a,status.eq.b))', COLS)
    expect(nested).toEqual({
      all: [
        {
          all: [
            { field: 'wins', op: 'gte', value: 1 },
            {
              any: [
                { field: 'status', op: 'eq', value: 'a' },
                { field: 'status', op: 'eq', value: 'b' },
              ],
            },
          ],
        },
      ],
    })
  })

  it('rejects unsupported ops with an actionable error', () => {
    expect(() => parsePostgrestFilter('tags=cs.{x}', COLS)).toThrow(/not supported/)
    expect(() => parsePostgrestFilter('doc=fts.hello', COLS)).toThrow(/full-text/)
  })

  it('rejects unknown ops, bad fields, and unsupported negation', () => {
    expect(() => parsePostgrestFilter('wins=bogus.1', COLS)).toThrow(/Unknown filter operator/)
    expect(() => parsePostgrestFilter('bad name=eq.1', COLS)).toThrow(/Invalid filter column/)
    expect(() => parsePostgrestFilter('name=not.match.x', COLS)).toThrow(/not supported/)
  })

  it('parses not.like / not.ilike into the negated pattern ops', () => {
    expect(parsePostgrestFilter('name=not.ilike.*jo*', COLS)).toEqual({
      all: [{ field: 'name', op: 'nilike', value: '*jo*' }],
    })
    expect(parsePostgrestFilter('name=not.like.jo*', COLS)).toEqual({
      all: [{ field: 'name', op: 'nlike', value: 'jo*' }],
    })
  })

  it('rejects silent-widening inputs: empty groups, empty in-lists, non-finite numbers', () => {
    expect(() => parsePostgrestFilter('wins=gte.1&or=()', COLS)).toThrow(/Empty or=\(\) group/)
    expect(() => parsePostgrestFilter('and=()', COLS)).toThrow(/Empty and=\(\) group/)
    expect(() => parsePostgrestFilter('status=in.()', COLS)).toThrow(/Empty in\.\(\) list/)
    expect(() => parsePostgrestFilter('wins=eq.Infinity', COLS)).toThrow(/Expected a number/)
    expect(() => parsePostgrestFilter('wins=eq.1e400', COLS)).toThrow(/Expected a number/)
  })

  it('rejects empty / malformed input', () => {
    expect(() => parsePostgrestFilter('', COLS)).toThrow(/empty/)
    expect(() => parsePostgrestFilter('justakey', COLS)).toThrow(/Malformed/)
  })

  it('honors quotes when splitting lists', () => {
    expect(parsePostgrestFilter('status=in.("a,b",c)', COLS)).toEqual({
      all: [{ field: 'status', op: 'in', value: ['a,b', 'c'] }],
    })
  })
})

describe('parsePostgrestOrder', () => {
  it('parses col.dir pairs and defaults to asc', () => {
    expect(parsePostgrestOrder('wins.desc,name', COLS)).toEqual([
      { field: 'wins', direction: 'desc' },
      { field: 'name', direction: 'asc' },
    ])
  })
  it('allows createdAt/updatedAt and rejects unknown columns', () => {
    expect(parsePostgrestOrder('createdAt.desc', COLS)).toEqual([
      { field: 'createdAt', direction: 'desc' },
    ])
    expect(() => parsePostgrestOrder('nope.asc', COLS)).toThrow(/Unknown sort column/)
  })
})

describe('predicateToPostgrest round-trips', () => {
  it('round-trips an AND of leaves', () => {
    const p: TablePredicate = {
      all: [
        { field: 'wins', op: 'gte', value: 10 },
        { field: 'slack_user_id', op: 'in', value: ['U1', 'U2'] },
      ],
    }
    const str = predicateToPostgrest(p)
    expect(str).toBe('wins=gte.10&slack_user_id=in.(U1,U2)')
    expect(parsePostgrestFilter(str, COLS)).toEqual(p)
  })

  it('round-trips an OR group', () => {
    const p: TablePredicate = {
      all: [
        {
          any: [
            { field: 'status', op: 'eq', value: 'active' },
            { field: 'status', op: 'eq', value: 'pending' },
          ],
        },
      ],
    }
    expect(parsePostgrestFilter(predicateToPostgrest(p), COLS)).toEqual(p)
  })

  it('serializes builder-only ops onto PostgREST forms', () => {
    expect(leaf('contains', 'foo')).toBe('name=ilike.*foo*')
    expect(leaf('startsWith', 'foo')).toBe('name=ilike.foo*')
    expect(leaf('ncontains', 'foo')).toBe('name=not.ilike.*foo*')
    // Emptiness desugars to groups preserving null-OR-empty-string semantics.
    expect(leaf('isEmpty')).toBe('or=(name.is.null,name.eq."")')
    expect(leaf('isNotEmpty')).toBe('and=(name.not.is.null,name.neq."")')
  })

  it('round-trips substring ops with reserved characters (whole-pattern quoting)', () => {
    const str = leaf('contains', 'example.com')
    expect(str).toBe('name=ilike."*example.com*"')
    expect(parsePostgrestFilter(str, COLS)).toEqual({
      all: [{ field: 'name', op: 'ilike', value: '*example.com*' }],
    })

    const ncontains = leaf('ncontains', 'a,b(c)=d')
    expect(parsePostgrestFilter(ncontains, COLS)).toEqual({
      all: [{ field: 'name', op: 'nilike', value: '*a,b(c)=d*' }],
    })
  })

  it('round-trips embedded quotes and backslashes through escaping', () => {
    const p: TablePredicate = {
      all: [{ field: 'name', op: 'eq', value: 'She said "hi"' }],
    }
    expect(parsePostgrestFilter(predicateToPostgrest(p), COLS)).toEqual(p)

    const list: TablePredicate = {
      all: [{ field: 'status', op: 'in', value: ['a"b', 'c\\d'] }],
    }
    expect(parsePostgrestFilter(predicateToPostgrest(list), COLS)).toEqual(list)
  })

  it('round-trips emptiness ops to their semantically-equal group form', () => {
    expect(parsePostgrestFilter(leaf('isEmpty'), COLS)).toEqual({
      all: [
        {
          any: [
            { field: 'name', op: 'isNull' },
            { field: 'name', op: 'eq', value: '' },
          ],
        },
      ],
    })
    expect(parsePostgrestFilter(leaf('isNotEmpty'), COLS)).toEqual({
      all: [
        {
          all: [
            { field: 'name', op: 'isNotNull' },
            { field: 'name', op: 'ne', value: '' },
          ],
        },
      ],
    })
  })

  it('rejects uppercase/typo sort directions instead of silently sorting asc', () => {
    expect(() => parsePostgrestOrder('wins.DESC', COLS)).toThrow(/Unknown sort direction/)
    expect(() => parsePostgrestOrder('wins.dsc', COLS)).toThrow(/Unknown sort direction/)
    expect(() => parsePostgrestOrder('wins.desc.extra', COLS)).toThrow(/Malformed sort/)
  })

  it('order spec round-trips', () => {
    const s = [
      { field: 'wins', direction: 'desc' as const },
      { field: 'name', direction: 'asc' as const },
    ]
    expect(sortSpecToPostgrestOrder(s)).toBe('wins.desc,name.asc')
    expect(parsePostgrestOrder(sortSpecToPostgrestOrder(s), COLS)).toEqual(s)
  })
})

function leaf(op: string, value?: string): string {
  return predicateToPostgrest({
    all: [
      value === undefined
        ? { field: 'name', op: op as never }
        : { field: 'name', op: op as never, value },
    ],
  })
}
