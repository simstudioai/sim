/**
 * @vitest-environment node
 *
 * Converter unit tests for the table query builder. Cover the operator
 * round-trips — UI rule → Filter object → UI rule — with attention to the
 * valueless `$empty` operator that maps to two distinct UI operators.
 */
import { describe, expect, it } from 'vitest'
import {
  filterRulesToFilter,
  filterRulesToPredicate,
  filterToRules,
  isTablePredicate,
  predicateToFilter,
  predicateToFilterRules,
  pruneFilterForColumns,
  prunePredicateForColumns,
  sortRulesToSortSpec,
  toLegacyFilter,
} from '@/lib/table/query-builder/converters'
import type { ColumnDefinition, FilterRule, SortRule, TablePredicate } from '@/lib/table/types'

function rule(overrides: Partial<FilterRule>): FilterRule {
  return {
    id: 'rule-1',
    logicalOperator: 'and',
    column: 'name',
    operator: 'eq',
    value: '',
    ...overrides,
  }
}

describe('filterRulesToFilter', () => {
  it('emits a bare value for eq (containment shorthand)', () => {
    expect(filterRulesToFilter([rule({ operator: 'eq', value: 'John' })])).toEqual({ name: 'John' })
  })

  it('wraps non-eq operators in a $-prefixed operator object', () => {
    expect(
      filterRulesToFilter([rule({ column: 'email', operator: 'startsWith', value: 'a' })])
    ).toEqual({ email: { $startsWith: 'a' } })
    expect(
      filterRulesToFilter([rule({ column: 'email', operator: 'ncontains', value: 'x' })])
    ).toEqual({ email: { $ncontains: 'x' } })
  })

  it('parses comma-separated values into arrays for in / nin', () => {
    expect(
      filterRulesToFilter([rule({ column: 'status', operator: 'nin', value: 'a, b' })])
    ).toEqual({ status: { $nin: ['a', 'b'] } })
  })

  it('serializes isEmpty / isNotEmpty to $empty without a value', () => {
    expect(filterRulesToFilter([rule({ column: 'phone', operator: 'isEmpty' })])).toEqual({
      phone: { $empty: true },
    })
    expect(filterRulesToFilter([rule({ column: 'phone', operator: 'isNotEmpty' })])).toEqual({
      phone: { $empty: false },
    })
  })

  it('merges two AND rules on the same column into one operator object', () => {
    const filter = filterRulesToFilter([
      rule({ id: 'a', column: 'age', operator: 'gt', value: '18' }),
      rule({ id: 'b', column: 'age', operator: 'lt', value: '65' }),
    ])
    expect(filter).toEqual({ age: { $gt: 18, $lt: 65 } })
  })

  it('normalizes a bare-equality shorthand when merging with an operator', () => {
    const filter = filterRulesToFilter([
      rule({ id: 'a', column: 'name', operator: 'eq', value: 'John' }),
      rule({ id: 'b', column: 'name', operator: 'contains', value: 'oh' }),
    ])
    expect(filter).toEqual({ name: { $eq: 'John', $contains: 'oh' } })
  })

  it('keeps same-column rules across an OR boundary in separate groups', () => {
    const filter = filterRulesToFilter([
      rule({ id: 'a', column: 'age', operator: 'gt', value: '18' }),
      rule({ id: 'b', logicalOperator: 'or', column: 'age', operator: 'lt', value: '5' }),
    ])
    expect(filter).toEqual({ $or: [{ age: { $gt: 18 } }, { age: { $lt: 5 } }] })
  })
})

describe('filterToRules', () => {
  it('maps $empty: true back to isEmpty and $empty: false back to isNotEmpty', () => {
    const empty = filterToRules({ phone: { $empty: true } })
    expect(empty).toHaveLength(1)
    expect(empty[0]).toMatchObject({ column: 'phone', operator: 'isEmpty', value: '' })

    const notEmpty = filterToRules({ phone: { $empty: false } })
    expect(notEmpty[0]).toMatchObject({ column: 'phone', operator: 'isNotEmpty', value: '' })
  })

  it("treats the string '$empty' operand the same as the boolean (no predicate flip)", () => {
    const empty = filterToRules({ phone: { $empty: 'true' } } as unknown as Parameters<
      typeof filterToRules
    >[0])
    expect(empty[0]).toMatchObject({ column: 'phone', operator: 'isEmpty', value: '' })

    const notEmpty = filterToRules({ phone: { $empty: 'false' } } as unknown as Parameters<
      typeof filterToRules
    >[0])
    expect(notEmpty[0]).toMatchObject({ column: 'phone', operator: 'isNotEmpty', value: '' })
  })

  it('round-trips string-pattern operators', () => {
    for (const operator of ['contains', 'ncontains', 'startsWith', 'endsWith'] as const) {
      const filter = filterRulesToFilter([rule({ column: 'name', operator, value: 'abc' })])
      const back = filterToRules(filter)
      expect(back[0]).toMatchObject({ column: 'name', operator, value: 'abc' })
    }
  })

  it('round-trips isEmpty through filterRulesToFilter', () => {
    const filter = filterRulesToFilter([rule({ column: 'name', operator: 'isEmpty' })])
    const back = filterToRules(filter)
    expect(back[0]).toMatchObject({ column: 'name', operator: 'isEmpty', value: '' })
  })

  it('round-trips a multi-operator column (Filter → rules → Filter) without loss', () => {
    const original = { age: { $gte: 18, $lte: 65 } }
    const rules = filterToRules(original)
    expect(rules).toHaveLength(2)
    expect(filterRulesToFilter(rules)).toEqual(original)
  })
})

describe('filterRulesToPredicate (v2)', () => {
  it('an AND group becomes a single all-group', () => {
    const p = filterRulesToPredicate([
      rule({ column: 'slack_user_id', operator: 'in', value: 'U1, U2' }),
      rule({ column: 'wins', operator: 'gte', value: '10' }),
    ])
    expect(p).toEqual({
      all: [
        { field: 'slack_user_id', op: 'in', value: ['U1', 'U2'] },
        { field: 'wins', op: 'gte', value: 10 },
      ],
    })
  })

  it('an or boundary splits into an any-of-all groups', () => {
    const p = filterRulesToPredicate([
      rule({ column: 'status', operator: 'eq', value: 'active' }),
      rule({ column: 'status', operator: 'eq', value: 'pending', logicalOperator: 'or' }),
    ])
    expect(p).toEqual({
      any: [
        { all: [{ field: 'status', op: 'eq', value: 'active' }] },
        { all: [{ field: 'status', op: 'eq', value: 'pending' }] },
      ],
    })
  })

  it('valueless ops omit the value', () => {
    const p = filterRulesToPredicate([rule({ column: 'note', operator: 'isEmpty' })])
    expect(p).toEqual({ all: [{ field: 'note', op: 'isEmpty' }] })
  })

  it('returns null for no rules', () => {
    expect(filterRulesToPredicate([])).toBeNull()
  })

  it('round-trips rules → predicate → rules (operator + value preserved)', () => {
    const rules: FilterRule[] = [
      rule({ column: 'wins', operator: 'gte', value: '10' }),
      rule({ column: 'name', operator: 'contains', value: 'jo', logicalOperator: 'or' }),
    ]
    const back = predicateToFilterRules(filterRulesToPredicate(rules))
    expect(back.map((r) => [r.column, r.operator, r.value, r.logicalOperator])).toEqual([
      ['wins', 'gte', '10', 'and'],
      ['name', 'contains', 'jo', 'or'],
    ])
  })
})

describe('predicateToFilterRules (v2)', () => {
  it('flattens an all-group to and-joined rules', () => {
    const p: TablePredicate = {
      all: [
        { field: 'a', op: 'eq', value: 1 },
        { field: 'b', op: 'isNotEmpty' },
      ],
    }
    const rules = predicateToFilterRules(p)
    expect(rules.map((r) => [r.column, r.operator, r.value])).toEqual([
      ['a', 'eq', '1'],
      ['b', 'isNotEmpty', ''],
    ])
  })

  it('returns [] for null', () => {
    expect(predicateToFilterRules(null)).toEqual([])
  })
})

describe('predicateToFilter (v2 → legacy)', () => {
  it('maps an all-group to $and with bare-op leaves', () => {
    const p: TablePredicate = {
      all: [
        { field: 'slack_user_id', op: 'in', value: ['U1', 'U2'] },
        { field: 'wins', op: 'gte', value: 10 },
        { field: 'name', op: 'eq', value: 'x' },
      ],
    }
    expect(predicateToFilter(p)).toEqual({
      $and: [{ slack_user_id: { $in: ['U1', 'U2'] } }, { wins: { $gte: 10 } }, { name: 'x' }],
    })
  })

  it('maps an any-group to $or and valueless ops to $empty', () => {
    const p: TablePredicate = {
      any: [
        { field: 'a', op: 'isEmpty' },
        { field: 'b', op: 'isNotEmpty' },
      ],
    }
    expect(predicateToFilter(p)).toEqual({
      $or: [{ a: { $empty: true } }, { b: { $empty: false } }],
    })
  })

  /**
   * The conversion is only safe if it is lossless: `buildFilterClause` skips an
   * `undefined` condition and any array-valued one, so a leaf that converts to
   * either DISAPPEARS from the WHERE — and a predicate whose only leaf disappears
   * compiles to no WHERE at all, turning a bulk delete into a table wipe.
   */
  it('throws rather than emit a leaf the legacy compiler would discard', () => {
    expect(() =>
      predicateToFilter({ all: [{ field: 'status', op: 'eq', value: ['a', 'b'] }] })
    ).toThrow(/does not accept an array/)
    expect(() => predicateToFilter({ all: [{ field: 'status', op: 'eq' }] })).toThrow(
      /requires a value/
    )
  })
})

describe('sortRulesToSortSpec (v2)', () => {
  it('maps rules to an ordered field/direction list', () => {
    const rules: SortRule[] = [
      { id: '1', column: 'wins', direction: 'desc' },
      { id: '2', column: 'name', direction: 'asc' },
    ]
    expect(sortRulesToSortSpec(rules)).toEqual([
      { field: 'wins', direction: 'desc' },
      { field: 'name', direction: 'asc' },
    ])
  })

  it('skips column-less rules and returns null when empty', () => {
    expect(sortRulesToSortSpec([{ id: '1', column: '', direction: 'asc' }])).toBeNull()
  })
})

it('does not throw "rules is not iterable" for a non-array builder value', () => {
  expect(filterRulesToPredicate({} as unknown as FilterRule[])).toBeNull()
  expect(filterRulesToPredicate(undefined as unknown as FilterRule[])).toBeNull()
})

it('rejects predicate-shaped members rather than dropping them', () => {
  // Mixing grammars used to silently discard the predicate-shaped leaf, widening
  // the filter — "delete archived rows for tenant acme" became "…for every tenant".
  expect(() =>
    filterRulesToPredicate([
      { field: 'tenant_id', op: 'eq', value: 'acme' },
      rule({ column: 'status', operator: 'eq', value: 'archived' }),
    ] as unknown as FilterRule[])
  ).toThrow(/predicate condition/)
})

it('still ignores a genuinely blank builder row', () => {
  expect(
    filterRulesToPredicate([
      rule({ column: '', operator: 'eq', value: '' }),
      rule({ column: 'status', operator: 'eq', value: 'archived' }),
    ])
  ).toEqual({ all: [{ field: 'status', op: 'eq', value: 'archived' }] })
})
describe('select option ids survive as text', () => {
  const numericIdColumn: ColumnDefinition = {
    id: 'status',
    name: 'status',
    type: 'select',
    options: [
      { id: '1', name: 'Open' },
      { id: 'true', name: 'Closed' },
    ],
  }

  it('does not coerce a numeric- or boolean-looking option id', () => {
    // Option ids are caller-supplied strings; `parseScalar` would turn these
    // into 1 / true, and JSONB containment against the stored string then
    // matches nothing while the picker still shows a valid option.
    expect(
      filterRulesToFilter([rule({ column: 'status', value: '1' })], [numericIdColumn])
    ).toEqual({ status: '1' })
    expect(
      filterRulesToFilter([rule({ column: 'status', value: 'true' })], [numericIdColumn])
    ).toEqual({ status: 'true' })
  })

  it('keeps each element of an $in list as text', () => {
    expect(
      filterRulesToFilter(
        [rule({ column: 'status', operator: 'in', value: '1, true' })],
        [numericIdColumn]
      )
    ).toEqual({ status: { $in: ['1', 'true'] } })
  })

  it('still coerces on a non-select column', () => {
    const age: ColumnDefinition = { id: 'age', name: 'age', type: 'number' }
    expect(filterRulesToFilter([rule({ column: 'age', value: '30' })], [age])).toEqual({ age: 30 })
  })

  it('survives the prune round-trip without coercion', () => {
    const filter = { status: '1' }
    // Nothing to prune here, but the pruned path re-serializes through the
    // converter — that round-trip must not turn the id back into a number.
    expect(pruneFilterForColumns(filter, [numericIdColumn])).toEqual({ status: '1' })
  })
})

describe('pruneFilterForColumns', () => {
  const single: ColumnDefinition = {
    id: 'col_s',
    name: 'status',
    type: 'select',
    options: [{ id: 'opt_a', name: 'Open' }],
  }
  const multi: ColumnDefinition = { ...single, multiple: true }
  const text: ColumnDefinition = { id: 'col_t', name: 'name', type: 'string' }

  it('drops an operator the column no longer accepts', () => {
    // `contains` was valid while `status` was text; as a single-select it is not.
    expect(pruneFilterForColumns({ status: { $contains: 'Op' } }, [single])).toBeNull()
    // ...and `eq` is the one a multiselect rejects.
    expect(pruneFilterForColumns({ status: 'opt_a' }, [multi])).toBeNull()
  })

  it('keeps the operators each cardinality does accept', () => {
    const eq = { status: 'opt_a' }
    expect(pruneFilterForColumns(eq, [single])).toBe(eq)
    const contains = { status: { $contains: 'opt_a' } }
    expect(pruneFilterForColumns(contains, [multi])).toBe(contains)
  })

  it('keeps sibling conditions when one is pruned', () => {
    const pruned = pruneFilterForColumns(
      { status: { $contains: 'Op' }, name: { $contains: 'ada' } },
      [single, text]
    )
    expect(pruned).toEqual({ name: { $contains: 'ada' } })
  })

  it('leaves non-select and unresolved columns for the server to judge', () => {
    const onText = { name: { $contains: 'ada' } }
    expect(pruneFilterForColumns(onText, [text])).toBe(onText)
    const unknown = { gone: { $contains: 'x' } }
    expect(pruneFilterForColumns(unknown, [single])).toBe(unknown)
  })

  it('returns the same object when nothing is pruned', () => {
    expect(pruneFilterForColumns(null, [single])).toBeNull()
  })
})

describe('filterRulesToPredicate select-awareness (grid parity)', () => {
  const SELECT_COLS: ColumnDefinition[] = [
    {
      id: 'col_status',
      name: 'col_status',
      type: 'select',
      options: [{ id: '123', name: 'One Two Three' }],
    },
  ]

  it('never scalar-coerces a select operand (a numeric-looking option id stays a string)', () => {
    const p = filterRulesToPredicate(
      [rule({ column: 'col_status', operator: 'eq', value: '123' })],
      SELECT_COLS
    )
    expect(p).toEqual({ all: [{ field: 'col_status', op: 'eq', value: '123' }] })
  })

  it('keeps select in-list members as strings', () => {
    const p = filterRulesToPredicate(
      [rule({ column: 'col_status', operator: 'in', value: '123, 456' })],
      SELECT_COLS
    )
    expect(p).toEqual({ all: [{ field: 'col_status', op: 'in', value: ['123', '456'] }] })
  })

  it('still coerces non-select columns', () => {
    const p = filterRulesToPredicate(
      [rule({ column: 'wins', operator: 'eq', value: '123' })],
      SELECT_COLS
    )
    expect(p).toEqual({ all: [{ field: 'wins', op: 'eq', value: 123 }] })
  })
})

describe('prunePredicateForColumns', () => {
  const COLS: ColumnDefinition[] = [
    { id: 'col_s', name: 'col_s', type: 'select', options: [{ id: 'o1', name: 'One' }] },
    { id: 'col_n', name: 'col_n', type: 'number' },
  ]

  it('drops an operator a select column no longer accepts, keeps the rest', () => {
    const p = prunePredicateForColumns(
      {
        all: [
          { field: 'col_s', op: 'contains', value: 'o1' }, // single-select: contains not allowed
          { field: 'col_n', op: 'gte', value: 5 },
        ],
      },
      COLS
    )
    expect(p).toEqual({ all: [{ field: 'col_n', op: 'gte', value: 5 }] })
  })

  it('returns the same reference when nothing is dropped', () => {
    const p = { all: [{ field: 'col_n', op: 'gte' as const, value: 5 }] }
    expect(prunePredicateForColumns(p, COLS)).toBe(p)
  })

  it('collapses to null when every condition is dropped', () => {
    expect(
      prunePredicateForColumns({ all: [{ field: 'col_s', op: 'contains', value: 'o1' }] }, COLS)
    ).toBeNull()
  })
})

describe('isTablePredicate', () => {
  it('discriminates the two grammars group-first', () => {
    expect(isTablePredicate({ all: [] })).toBe(true)
    expect(isTablePredicate({ any: [] })).toBe(true)
    expect(isTablePredicate({ status: 'active' })).toBe(false)
    expect(isTablePredicate({ $or: [{ a: 1 }] } as never)).toBe(false)
  })
})

it('prunePredicateForColumns fails closed on a malformed value instead of throwing', () => {
  expect(prunePredicateForColumns({ column: 'name', operator: 'eq' } as never, [])).toBeNull()
})

/**
 * Review findings from PR #6067 (greptile P1 ×2, bugbot High). The dual-grammar
 * union's legacy branch accepts any non-empty object WITHOUT stripping, so a
 * hybrid node reaches the downgrade Zod-approved — and predicateToFilter used
 * to convert it group-first, silently DROPPING the leaf half and widening the
 * filter on the async destructive routes (delete-async, cancel-runs, columns/run).
 */
describe('toLegacyFilter / predicateToFilter hybrid safety', () => {
  const hybrid = {
    all: [{ field: 'tenant_id', op: 'eq', value: 'acme' }],
    field: 'status',
    op: 'eq',
    value: 'archived',
  } as never

  it('predicateToFilter throws on a hybrid node instead of dropping the leaf', () => {
    expect(() => predicateToFilter(hybrid)).toThrow(/not both/)
  })

  it('throws on a node with both group keys instead of dropping the "any" half', () => {
    const dual = {
      all: [{ field: 'tenant_id', op: 'eq', value: 'acme' }],
      any: [{ field: 'status', op: 'eq', value: 'archived' }],
    } as never
    expect(() => predicateToFilter(dual)).toThrow(/either "all" or "any"/)
    expect(() => toLegacyFilter(dual)).toThrow(/either "all" or "any"/)
  })

  it('toLegacyFilter shape-validates before converting', () => {
    expect(() => toLegacyFilter(hybrid)).toThrow(/not both/)
    // malformed group value is also caught, not crashed on
    expect(() => toLegacyFilter({ all: [{ all: 'x' }] } as never)).toThrow()
  })

  it('toLegacyFilter passes a well-formed predicate and a legacy filter through', () => {
    expect(toLegacyFilter({ all: [{ field: 'a', op: 'eq', value: 1 }] })).toEqual({
      $and: [{ a: 1 }],
    })
    expect(toLegacyFilter({ status: 'archived' })).toEqual({ status: 'archived' })
  })
})

describe('isTablePredicate vs columns literally named all/any', () => {
  it('routes a non-array all/any value to the legacy compiler (a real column)', () => {
    // NAME_PATTERN allows a column named "all". Equality shorthand and operator
    // objects on it are legacy filters, not predicate groups.
    expect(isTablePredicate({ all: 'x' } as never)).toBe(false)
    expect(isTablePredicate({ any: { $eq: 'x' } } as never)).toBe(false)
  })

  it('array-valued all/any is a predicate group (documented precedence)', () => {
    // A legacy filter with an ARRAY on a regular field was always a dropped
    // no-op condition, so predicate precedence here regresses nothing.
    expect(isTablePredicate({ all: [] })).toBe(true)
    expect(isTablePredicate({ any: [{ field: 'a', op: 'eq', value: 1 }] })).toBe(true)
  })
})

it('toLegacyFilter rejects an empty group instead of downgrading it to no WHERE', () => {
  expect(() => toLegacyFilter({ all: [] })).toThrow(/at least one condition/)
})
