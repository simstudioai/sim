import {
  type ConditionClause,
  type ConditionLookup,
  evaluateClause,
  evaluateCondition,
} from '../catalog/conditions'
import type { CatalogField, FieldIndex } from '../catalog/surface'
import type { CatalogSubBlock } from '../catalog/types'
import { isPlainRecord, type SubBlockId, type Value } from '../model'
import { getOwn } from '../records'

/** The field a written param name targets: its written name or, when aliased, its own name. */
export function fieldFor(index: FieldIndex, key: string): CatalogField | undefined {
  return index.fields.get(key) ?? index.aliased.get(key)
}

/** A lookup over a block's compiled params, every one of them known. */
export function paramLookup(values: ReadonlyMap<string, Value>): ConditionLookup {
  return (field: string) => ({ value: values.get(field) })
}

/** Whether a field may be shown: only a field the catalog's data decides hidden is not. */
export function isVisible(sub: CatalogSubBlock, values: ReadonlyMap<string, Value>): boolean {
  return evaluateCondition(sub, paramLookup(values)) !== false
}

/** A clause list longer than this is described by the value it rejects, not by what it lists. */
const LISTED_VALUES = 3

/**
 * Why {@link isVisible} hides a field, as a clause: the value that hides it (`model gpt-5 does
 * not use it`), or for a short data condition the values it shows under (`it shows only when
 * operation is send`); `null` when the condition data does not say.
 */
export function hiddenReason(
  sub: CatalogSubBlock,
  values: ReadonlyMap<string, Value>
): string | null {
  const { condition, visibleFor, visibleWhen, visibleForModel } = sub
  const rejected = (field: string) => {
    const value = values.get(field)
    return `${field} ${value === undefined || value === null ? 'unset' : String(value)} does not use it`
  }
  if (!condition) return null
  const lookup = paramLookup(values)
  /** The part of `clause` that hides the field, described; `null` when none does. */
  const failingPart = (clause: ConditionClause): string | null => {
    const failing = [clause, clause.and].find(
      (part): part is NonNullable<typeof part> =>
        part !== undefined &&
        evaluateClause({ field: part.field, value: part.value, not: part.not }, lookup) === false
    )
    if (!failing) return null
    if (Array.isArray(failing.value) && failing.value.length > LISTED_VALUES) {
      return rejected(failing.field)
    }
    const wanted = Array.isArray(failing.value)
      ? failing.value.map(String).join(' or ')
      : String(failing.value)
    return `it shows only when ${failing.field} is ${failing.not ? 'not ' : ''}${wanted}`
  }
  if (!('opaque' in condition)) return failingPart(condition)
  // The order `evaluateCondition` decides an opaque condition in: the operation, then the clause
  // `visibleWhen` still asks for it, and the model only for an operation `visibleFor` omits.
  const operation = values.get('operation')
  if (typeof operation === 'string' && visibleFor && Object.hasOwn(visibleFor, operation)) {
    if (!visibleFor[operation]) return rejected('operation')
    const asked = visibleWhen && getOwn(visibleWhen, operation)
    return asked ? failingPart(asked) : null
  }
  const model = values.get('model')
  if (typeof model === 'string' && visibleForModel?.[model] === false) return rejected('model')
  return null
}

/**
 * The fields a block leaves empty although they are required under the values it runs with
 * (`W_REQUIRED_MISSING`). `values` are the block's compiled params, which already hold each
 * omitted field's editor default (`catalog/defaults.ts` `editorDefaults`, the one source of what
 * an omitted param means), so an omitted Slack `destinationType` reads as the `'channel'` the
 * canvas writes. A field counts when no member holds a value and some member is certainly visible
 * and certainly required under those values: a provider's credential fields never count for a
 * model of another provider, and the half of a channel/DM switch the block does not use never
 * counts. The server's lint, which runs the registry's own conditions, still reports what this
 * static check cannot decide.
 */
export function missingRequiredFields(
  index: FieldIndex,
  values: ReadonlyMap<string, Value>,
  isWritten: (subBlockId: SubBlockId) => boolean
): CatalogField[] {
  const missing: CatalogField[] = []
  for (const field of index.fields.values()) {
    const members = field.kind === 'single' ? [field.sub] : field.members
    if (members.some((sub) => isWritten(sub.id))) continue
    const lookup = paramLookup(values)
    const declared = members.flatMap((sub) => index.declarations.get(sub.id) ?? [sub])
    if (
      declared.some((sub) => evaluateCondition(sub, lookup) === true && isRequired(sub, values))
    ) {
      missing.push(field)
    }
  }
  return missing
}

/** Whether a field certainly needs a value: an opaque `required` function is not decided. */
function isRequired(sub: CatalogSubBlock, values: ReadonlyMap<string, Value>): boolean {
  if (sub.defaultValue !== undefined || sub.valueDefault !== undefined) return false
  if (sub.hidden || sub.readOnly) return false
  if (sub.required === undefined || sub.required === false) return false
  if (sub.required === true) return true
  if ('opaque' in sub.required) return false
  return evaluateClause(sub.required, paramLookup(values)) === true
}

/**
 * Whether a literal value has the JSON type its field expects (`valueKind`; a free-text input
 * also takes a number). Never coerced: a mismatch is `W_VALUE_KIND` and the exact value is kept.
 */
export function valueKindMatches(
  sub: Pick<CatalogSubBlock, 'acceptsNumber' | 'valueKind'>,
  value: Value
): boolean {
  switch (sub.valueKind) {
    case 'string':
      return typeof value === 'string' || (sub.acceptsNumber === true && typeof value === 'number')
    case 'code':
    case 'picked':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number'
    case 'boolean':
      return typeof value === 'boolean'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return isPlainRecord(value)
    case 'resource':
      return typeof value === 'object' && value !== null && '$sim' in value
    case 'upload':
      return Array.isArray(value) ? value.every(isPlainRecord) : isPlainRecord(value)
    case 'json':
    case 'branches':
    case 'tools':
    case 'none':
      return true
    default: {
      // A kind from a catalog newer than this engine is not checked.
      const unknownKind: never = sub.valueKind
      return typeof unknownKind === 'string'
    }
  }
}
