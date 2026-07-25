/**
 * @vitest-environment node
 *
 * Guards for the select column-type conversion rules. These paths had no
 * coverage and every case below was a shipped defect caught in review.
 */
import { describe, expect, it } from 'vitest'
import { isValueCompatibleWithType, selectValueForConversion } from '@/lib/table/columns/service'
import type { ColumnDefinition, SelectOption } from '@/lib/table/types'

const OPTIONS: SelectOption[] = [
  { id: 'opt_a', name: 'Alpha' },
  { id: 'opt_b', name: 'Beta' },
]

const single: ColumnDefinition = {
  id: 'col_s',
  name: 'status',
  type: 'select',
  options: OPTIONS,
}
const multi: ColumnDefinition = { ...single, id: 'col_m', multiple: true }

describe('selectValueForConversion', () => {
  it('resolves a single option id to its name', () => {
    expect(selectValueForConversion(single, 'opt_a')).toBe('Alpha')
  })

  it('joins a multiselect into one string', () => {
    expect(selectValueForConversion(multi, ['opt_a', 'opt_b'])).toBe('Alpha, Beta')
  })

  it('nulls an empty or fully-orphaned selection', () => {
    expect(selectValueForConversion(multi, [])).toBeNull()
    expect(selectValueForConversion(multi, ['gone'])).toBeNull()
    expect(selectValueForConversion(single, 'gone')).toBeNull()
  })
})

describe('isValueCompatibleWithType — empty strings', () => {
  it('does not let an empty string satisfy a numeric target', () => {
    // Regression: '' was briefly compatible with EVERY type, so a text column
    // with blank cells could convert to number and strand them.
    expect(isValueCompatibleWithType('', 'number')).toBe(false)
    expect(isValueCompatibleWithType('', 'boolean')).toBe(false)
    expect(isValueCompatibleWithType('', 'date')).toBe(false)
  })

  it('still allows a cleared select cell to convert', () => {
    expect(isValueCompatibleWithType('', 'select', OPTIONS)).toBe(true)
  })
})

describe('isValueCompatibleWithType — select cardinality', () => {
  it('rejects several options for a single-select target', () => {
    expect(isValueCompatibleWithType(['opt_a', 'opt_b'], 'select', OPTIONS, false)).toBe(false)
  })

  it('accepts several options for a multi-select target', () => {
    expect(isValueCompatibleWithType(['opt_a', 'opt_b'], 'select', OPTIONS, true)).toBe(true)
  })

  it('accepts a lone option either way', () => {
    expect(isValueCompatibleWithType(['opt_a'], 'select', OPTIONS, false)).toBe(true)
    expect(isValueCompatibleWithType('opt_a', 'select', OPTIONS, false)).toBe(true)
  })

  it('rejects a value that is not a declared option', () => {
    expect(isValueCompatibleWithType('gone', 'select', OPTIONS, false)).toBe(false)
  })

  it('round-trips a multiselect through text', () => {
    // multiselect → string flattens to `Alpha, Beta`; converting back must read
    // that the same way the write-path coercion does, not as one unknown option.
    const flattened = selectValueForConversion(multi, ['opt_a', 'opt_b'])
    expect(flattened).toBe('Alpha, Beta')
    expect(isValueCompatibleWithType(flattened, 'select', OPTIONS, true)).toBe(true)
    // A single-select target genuinely can't hold both.
    expect(isValueCompatibleWithType(flattened, 'select', OPTIONS, false)).toBe(false)
  })

  it('rejects a blank source value when the target select is required', () => {
    // `required` only rejects null/undefined on a write, so a required string
    // column legitimately holds ''. Converting it stores null (or [] for a
    // multi), which would then fail that column's own required check on the
    // next update of the row.
    expect(isValueCompatibleWithType('', 'select', OPTIONS, false, true)).toBe(false)
    expect(isValueCompatibleWithType('', 'select', OPTIONS, true, true)).toBe(false)
    // Optional target is unchanged — a cleared cell stays convertible.
    expect(isValueCompatibleWithType('', 'select', OPTIONS, false, false)).toBe(true)
  })

  it('still rejects a comma string holding an undeclared option', () => {
    expect(isValueCompatibleWithType('Alpha, Gone', 'select', OPTIONS, true)).toBe(false)
  })
})

describe('isValueCompatibleWithType — string target', () => {
  it('rejects structured values that text cannot represent', () => {
    expect(isValueCompatibleWithType(['opt_a'], 'string')).toBe(false)
    expect(isValueCompatibleWithType({ a: 1 }, 'string')).toBe(false)
  })

  it('accepts primitives', () => {
    expect(isValueCompatibleWithType('Alpha', 'string')).toBe(true)
    expect(isValueCompatibleWithType(42, 'string')).toBe(true)
    expect(isValueCompatibleWithType(true, 'string')).toBe(true)
  })

  it('accepts a multiselect once flattened for conversion', () => {
    // This is the pairing updateColumnType relies on: flatten, then check.
    const flattened = selectValueForConversion(multi, ['opt_a', 'opt_b'])
    expect(isValueCompatibleWithType(flattened, 'string')).toBe(true)
  })
})
