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
  filterToRules,
  pruneFilterForColumns,
  pruneViewFilterForColumns,
} from '@/lib/table/query-builder/converters'
import type { ColumnDefinition, FilterRule } from '@/lib/table/types'

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

describe('pruneViewFilterForColumns', () => {
  it('recursively drops deleted stable column ids and empty groups', () => {
    const columns: ColumnDefinition[] = [{ id: 'col_live', name: 'Live', type: 'text' }]
    expect(
      pruneViewFilterForColumns(
        {
          $or: [
            { col_gone: { $eq: 'x' } },
            { $and: [{ col_live: { $contains: 'A' } }, { col_gone: { $eq: 'y' } }] },
          ],
        },
        columns
      )
    ).toEqual({ $or: [{ $and: [{ col_live: { $contains: 'A' } }] }] })
    expect(pruneViewFilterForColumns({ col_gone: 'x' }, columns)).toBeNull()
  })
})
