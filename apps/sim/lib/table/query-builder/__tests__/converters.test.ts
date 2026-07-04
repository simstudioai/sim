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
  filterRulesToPostgrest,
  filterRulesToPredicate,
  filterToRules,
  predicateToFilter,
  predicateToFilterRules,
  sortRulesToPostgrestOrder,
  sortRulesToSortSpec,
} from '@/lib/table/query-builder/converters'
import type { FilterRule, SortRule, TablePredicate } from '@/lib/table/types'

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

describe('filterRulesToPostgrest', () => {
  it('serializes builder rules to a PostgREST querystring', () => {
    expect(
      filterRulesToPostgrest([
        rule({ column: 'wins', operator: 'gte', value: '10' }),
        rule({ column: 'status', operator: 'eq', value: 'active' }),
      ])
    ).toBe('wins=gte.10&status=eq.active')
  })

  it('serializes an OR boundary to an or() group', () => {
    expect(
      filterRulesToPostgrest([
        rule({ column: 'status', operator: 'eq', value: 'active' }),
        rule({ column: 'status', operator: 'eq', value: 'pending', logicalOperator: 'or' }),
      ])
    ).toBe('or=(status.eq.active,status.eq.pending)')
  })

  it('maps builder-only ops onto PostgREST forms', () => {
    expect(
      filterRulesToPostgrest([rule({ column: 'name', operator: 'contains', value: 'jo' })])
    ).toBe('name=ilike.*jo*')
    // isEmpty keeps its null-OR-empty-string semantics through the string form.
    expect(filterRulesToPostgrest([rule({ column: 'name', operator: 'isEmpty' })])).toBe(
      'or=(name.is.null,name.eq."")'
    )
  })

  it('returns null for an empty builder', () => {
    expect(filterRulesToPostgrest([])).toBeNull()
  })

  it('returns null (does not throw "rules is not iterable") for a non-array value', () => {
    expect(filterRulesToPostgrest({} as unknown as FilterRule[])).toBeNull()
    expect(filterRulesToPostgrest(undefined as unknown as FilterRule[])).toBeNull()
  })
})

describe('sortRulesToPostgrestOrder', () => {
  it('serializes sort rules to a PostgREST order string', () => {
    expect(
      sortRulesToPostgrestOrder([
        { id: '1', column: 'wins', direction: 'desc' },
        { id: '2', column: 'name', direction: 'asc' },
      ])
    ).toBe('wins.desc,name.asc')
  })

  it('returns null when empty', () => {
    expect(sortRulesToPostgrestOrder([])).toBeNull()
  })
})
