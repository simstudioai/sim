import { type ConditionLookup, evaluateClause, evaluateCondition } from '../catalog/conditions'
import type { CatalogField, FieldIndex } from '../catalog/surface'
import type { CatalogSubBlock } from '../catalog/types'
import { isPlainRecord, type SubBlockId, type Value } from '../model'

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
      // A kind from a catalog newer than this engine is not checked, as before.
      const unknownKind: never = sub.valueKind
      return typeof unknownKind === 'string'
    }
  }
}
