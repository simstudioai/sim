import { TagIcon } from '@sim/emcn/icons'
import { CELL_RULES } from '@sim/table-cells/rules'
import { resolveSelectOptionId, splitMultiSelectInput } from '@sim/table-cells/select'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'
import { MAX_SELECT_OPTIONS } from '@/lib/table/constants'
import { selectValueToNames } from '@/lib/table/select-values'
import type { FilterOp, JsonValue } from '@/lib/table/types'

/**
 * Operators that make sense on a `select` column (whose values are opaque option
 * ids), split by cardinality. A single-select cell holds one id, so it compares
 * for equality; a multi-select cell holds an array of ids, so the question is
 * membership — hence contains / does-not-contain. `$eq` against an array cell
 * can never be true (`{"t":["a"]} @> {"t":"a"}` is false in Postgres), so
 * allowing it would silently match nothing.
 */
export const SINGLE_SELECT_OPERATORS: ReadonlySet<string> = new Set([
  '$eq',
  '$ne',
  '$in',
  '$nin',
  '$empty',
])
export const MULTI_SELECT_OPERATORS: ReadonlySet<string> = new Set([
  '$contains',
  '$ncontains',
  '$empty',
])

/**
 * The same allowlists in the v2 bare-operator grammar, applied inside
 * `fieldPredicate` so both wire formats gate identically. Not derived from the
 * `$` sets above by string surgery because the mapping is not 1:1 — `$empty`
 * splits into `isEmpty`/`isNotEmpty`. `isNull`/`isNotNull` have no `$`
 * equivalent and are allowed on both: a strict null check is meaningful on any
 * column, select included.
 *
 * Exported so LLM enrichment can DERIVE the operator guidance it gives the
 * model rather than restating it. A hand-copied list drifts, and the cost of
 * drift here is a predicate the validator rejects at run time.
 */
export const SINGLE_SELECT_OPS: ReadonlySet<FilterOp> = new Set<FilterOp>([
  'eq',
  'ne',
  'in',
  'nin',
  'isEmpty',
  'isNotEmpty',
  'isNull',
  'isNotNull',
])
export const MULTI_SELECT_OPS: ReadonlySet<FilterOp> = new Set<FilterOp>([
  'contains',
  'ncontains',
  'isEmpty',
  'isNotEmpty',
  'isNull',
  'isNotNull',
])

export const selectColumnType: ColumnTypeDefinition = {
  id: 'select',
  label: 'Select',
  icon: TagIcon,
  // Cells hold opaque option ids; comparison is by id, never by cast.
  jsonbCast: null,
  storesOpaqueIds: true,
  supportsUnique: false,
  sampleValue: 'Option',
  ownedMetadata: ['options', 'multiple'],
  workflowInputType: 'string',
  editor: 'select',
  expandable: false,

  filterOperatorsFor(column) {
    return column.multiple ? MULTI_SELECT_OPERATORS : SINGLE_SELECT_OPERATORS
  },

  ...CELL_RULES.select,

  validateDefinition(column) {
    const errors: string[] = []
    const options = column.options
    if (!Array.isArray(options) || options.length === 0) {
      errors.push(
        `Column "${column.name}" of type "${column.type}" must define at least one option`
      )
      return errors
    }
    if (options.length > MAX_SELECT_OPTIONS) {
      errors.push(`Column "${column.name}" cannot have more than ${MAX_SELECT_OPTIONS} options`)
    }

    const ids = new Set<string>()
    const names = new Set<string>()
    for (const opt of options) {
      if (!opt.id || typeof opt.id !== 'string') {
        errors.push(`Column "${column.name}" has an option missing an id`)
      } else if (ids.has(opt.id)) {
        errors.push(`Column "${column.name}" has duplicate option id "${opt.id}"`)
      } else {
        ids.add(opt.id)
      }
      if (!opt.name || typeof opt.name !== 'string') {
        errors.push(`Column "${column.name}" has an option missing a name`)
      } else {
        const key = opt.name.toLowerCase()
        if (names.has(key)) {
          errors.push(`Column "${column.name}" has duplicate option name "${opt.name}"`)
        } else {
          names.add(key)
        }
      }
    }
    return errors
  },

  isCompatibleWith(value, target) {
    // A cleared select cell is written as '' — still convertible, unless the
    // target is required. Required only rejects null/undefined on a write, so
    // a required string column legitimately holds ''; the migration turns that
    // into null (or [] for a multi), and every later update of that row would
    // then fail its own required check.
    if (value === '') return !target.required
    // Read the value exactly as the write-path coercion will. A multi target
    // splits a comma-delimited string, so a multiselect → text → multiselect
    // round-trip (text holding this feature's own `Bug, Docs` export shape)
    // stays convertible instead of being rejected as one unknown option.
    const parts = target.multiple
      ? splitMultiSelectInput(value as JsonValue)
      : Array.isArray(value)
        ? value
        : [value]
    // A single-select target can't hold several options. `updateColumnOptions`
    // blocks the same transition; without this the next coerce would silently
    // keep only the first id.
    if (!target.multiple && parts.length > 1) return false
    const options = target.options ?? []
    return parts.every((v) => resolveSelectOptionId(v as JsonValue, options) !== null)
  },

  formatForDisplay(value, column) {
    const resolved = selectValueToNames(column, value)
    return Array.isArray(resolved) ? resolved.join(', ') : (resolved ?? '')
  },

  formatForInput(value, column) {
    return selectColumnType.formatForDisplay(value, column)
  },
}
