/**
 * @vitest-environment node
 *
 * Guards for the select column-type conversion rules. These paths had no
 * coverage and every case below was a shipped defect caught in review.
 */
import { describe, expect, it } from 'vitest'
import { COLUMN_TYPE_REGISTRY } from '@/lib/table/column-types'
import {
  applyPendingRename,
  isValueCompatibleWithColumn,
  selectValueForConversion,
} from '@/lib/table/columns/service'
import { resolveSelectOptionId } from '@/lib/table/select-options'
import type { ColumnDefinition, ColumnType, SelectOption } from '@/lib/table/types'

/**
 * Marshals the loose per-type arguments these cases are written in into the
 * target column the gate takes. Lives here rather than in the service so
 * production has only the whole-column form, which cannot drop a metadata key.
 */
function isValueCompatibleWithType(
  value: unknown,
  targetType: ColumnType,
  targetOptions: SelectOption[] = [],
  targetMultiple = false,
  targetRequired = false
): boolean {
  return isValueCompatibleWithColumn(value, {
    name: '',
    type: targetType,
    options: targetOptions,
    multiple: targetMultiple,
    required: targetRequired,
  })
}

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

describe('isValueCompatibleWithType — currency', () => {
  it('accepts numbers and the formatted shapes a text column holds', () => {
    expect(isValueCompatibleWithType(1234.56, 'currency')).toBe(true)
    expect(isValueCompatibleWithType(0, 'currency')).toBe(true)
    expect(isValueCompatibleWithType('$1,234.56', 'currency')).toBe(true)
    expect(isValueCompatibleWithType('1.234,56 €', 'currency')).toBe(true)
    expect(isValueCompatibleWithType('(12.00)', 'currency')).toBe(true)
  })

  it('rejects values that would leave un-castable text in a numeric column', () => {
    expect(isValueCompatibleWithType('ask sales', 'currency')).toBe(false)
    expect(isValueCompatibleWithType('', 'currency')).toBe(false)
    expect(isValueCompatibleWithType(true, 'currency')).toBe(false)
    expect(isValueCompatibleWithType({ amount: 1 }, 'currency')).toBe(false)
  })

  it('treats an absent cell as convertible, like every other target type', () => {
    expect(isValueCompatibleWithType(null, 'currency')).toBe(true)
    expect(isValueCompatibleWithType(undefined, 'currency')).toBe(true)
  })

  it('accepts a currency cell converting back to a plain number', () => {
    expect(isValueCompatibleWithType(1234.56, 'number')).toBe(true)
  })
})

describe('blank cells during conversion', () => {
  // A text column with a single empty cell could not be converted to a number
  // at all: `''` is incompatible with every numeric type, and the scan counted
  // it as a hard blocker even when the target was optional — reporting it with
  // an error that said "to a required ..." regardless.
  it('treats an empty cell as incompatible with the numeric types', () => {
    for (const type of ['number', 'currency'] as const) {
      expect(isValueCompatibleWithType('', type)).toBe(false)
    }
  })

  it('still accepts an empty string for text, which can legitimately hold it', () => {
    expect(isValueCompatibleWithType('', 'string')).toBe(true)
    expect(isValueCompatibleWithType('', 'json')).toBe(true)
  })

  it('lets a cleared select cell through only when the target is optional', () => {
    expect(isValueCompatibleWithType('', 'select', OPTIONS, false, false)).toBe(true)
    expect(isValueCompatibleWithType('', 'select', OPTIONS, false, true)).toBe(false)
  })
})

describe('rename folded into another write', () => {
  // A rename is metadata-only — rows key on the stable column id — so nothing
  // forces it to be its own transaction. Folding it into whichever write a
  // request already carries is what makes a combined PATCH all-or-nothing: the
  // name collision is detected against the same schema snapshot the other
  // change is being applied to, and both abort together.
  it('rejects a collision against the schema the write is landing in', () => {
    const columns: ColumnDefinition[] = [
      { id: 'col_a', name: 'amount', type: 'currency' },
      { id: 'col_b', name: 'taken', type: 'string' },
    ]
    expect(() => applyPendingRename(columns, 0, 'taken')).toThrow(/already exists/)
    expect(() => applyPendingRename(columns, 0, 'TAKEN')).toThrow(/already exists/)
  })

  it('signals a no-op by identity, which is how callers detect nothing to write', () => {
    // The early returns in `updateColumnType` / `updateColumnCurrency` rely on
    // this: same reference means there is genuinely nothing to persist.
    const columns: ColumnDefinition[] = [{ id: 'col_a', name: 'amount', type: 'currency' }]
    expect(applyPendingRename(columns, 0, undefined)).toBe(columns[0])
    expect(applyPendingRename(columns, 0, 'amount')).toBe(columns[0])
    expect(applyPendingRename(columns, 0, 'renamed')).not.toBe(columns[0])
  })

  it('applies a valid rename and is a no-op without one', () => {
    const columns: ColumnDefinition[] = [{ id: 'col_a', name: 'amount', type: 'currency' }]
    expect(applyPendingRename(columns, 0, 'total').name).toBe('total')
    expect(applyPendingRename(columns, 0, undefined)).toBe(columns[0])
    expect(applyPendingRename(columns, 0, 'amount')).toBe(columns[0])
  })

  it('rejects a name the column-name rules forbid', () => {
    const columns: ColumnDefinition[] = [{ id: 'col_a', name: 'amount', type: 'currency' }]
    expect(() => applyPendingRename(columns, 0, '1bad')).toThrow(/must start with/)
    expect(() => applyPendingRename(columns, 0, 'a'.repeat(200))).toThrow(/maximum length/)
  })
})

describe('select accepts scalar cells', () => {
  // The resolver stringifies a scalar before matching, so a `number` or
  // `boolean` column whose values equal option NAMES converts. The migration's
  // JSONB predicate has to cover those types too — matching only `'string'`
  // left the cells as raw numbers inside a select column, where they render as
  // nothing and fail option membership on the next write.
  const NUMERIC_OPTIONS: SelectOption[] = [
    { id: 'opt_1', name: '123' },
    { id: 'opt_t', name: 'true' },
  ]

  it('resolves a numeric or boolean cell to its option id', () => {
    expect(resolveSelectOptionId(123, NUMERIC_OPTIONS)).toBe('opt_1')
    expect(resolveSelectOptionId(true, NUMERIC_OPTIONS)).toBe('opt_t')
  })

  it('reports those cells as convertible, which is what obliges the migration', () => {
    expect(isValueCompatibleWithType(123, 'select', NUMERIC_OPTIONS)).toBe(true)
    expect(isValueCompatibleWithType(true, 'select', NUMERIC_OPTIONS)).toBe(true)
    expect(isValueCompatibleWithType(999, 'select', NUMERIC_OPTIONS)).toBe(false)
  })

  it('leaves structured values unresolvable', () => {
    expect(resolveSelectOptionId({ a: 1 } as never, NUMERIC_OPTIONS)).toBeNull()
  })
})

describe('constraint validation reads post-migration values', () => {
  // The ordering that matters: `updateColumnOptions` rewrites stored cells (a
  // single<->multi toggle changes the shape; removing an option clears cells),
  // and `updateColumnType` rewrites them through the coercion write-back. A
  // `unique` scan run BEFORE those would read values that no longer exist by
  // the time the constraint is persisted, pass, and let the rewrite produce the
  // duplicates it was supposed to prevent.
  //
  // The coercion case is the concrete one: two distinct strings can collapse to
  // one number.
  it('shows how a conversion manufactures duplicates the pre-scan cannot see', () => {
    const column: ColumnDefinition = { name: 'sku', type: 'number' }
    const before = ['5', '5.0']
    expect(new Set(before).size).toBe(2)

    const after = before.map((value) => {
      const coerced = COLUMN_TYPE_REGISTRY.number.coerce(value, column)
      return coerced.ok ? coerced.value : value
    })
    expect(after).toEqual([5, 5])
    expect(new Set(after).size).toBe(1)
  })
})
