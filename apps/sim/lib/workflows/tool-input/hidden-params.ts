import { isRecordLike } from '@sim/utils/object'
import {
  evaluateSubBlockCondition,
  isNonEmptyValue,
  type SubBlockCondition,
} from '@sim/workflow-code/catalog/canonical-index'
import type { SubBlockConfig } from '@/blocks/types'

type ConditionSubBlock = Pick<
  SubBlockConfig,
  | 'id'
  | 'type'
  | 'mode'
  | 'condition'
  | 'reactiveCondition'
  | 'canonicalParamId'
  | 'password'
  | 'options'
>

/**
 * Whether `operation` is one of the block's own operation choices. Only then can a condition on
 * `operation` be decided: a stored row with no operation, or one holding a tool id the dropdown
 * does not list, leaves every operation-gated field undecided.
 */
function isBlockOperation(
  subBlocks: ConditionSubBlock[],
  operation: string,
  values: Record<string, unknown>
): boolean {
  return subBlocks.some((subBlock) => {
    if (subBlock.id !== 'operation' || subBlock.mode === 'trigger') return false
    if (subBlock.mode === 'trigger-advanced' || !subBlock.options) return false
    let options: unknown
    try {
      options =
        typeof subBlock.options === 'function' ? subBlock.options({ values }) : subBlock.options
    } catch {
      return false
    }
    return (
      Array.isArray(options) &&
      options.some((option) => isRecordLike(option) && option.id === operation)
    )
  })
}

/** A stored scalar a condition can be decided against; JSON-shaped and empty values cannot. */
function isDecidableValue(value: unknown): boolean {
  if (typeof value === 'boolean' || typeof value === 'number') return true
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed.length > 0 && !trimmed.startsWith('[') && !trimmed.startsWith('{')
}

/** The typed reading of a stored string, since a tool row stores `true` and `3` as text. */
function decodeScalar(value: unknown): unknown {
  if (value === 'true') return true
  if (value === 'false') return false
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return value
}

/**
 * True only when the clause is decidably false. A clause on a field with no decidable value is
 * treated as satisfiable, and the stored value is also tried in the clause's own type, so every
 * doubt resolves toward keeping the value. A clause whose options are all strings compares the
 * stored value as text: a typed reading of `'true'` would always satisfy a `not` clause on the
 * string option `'true'`, leaving it undecidable.
 */
function isClauseFalse(
  clause: SubBlockCondition,
  values: Record<string, unknown>,
  isDecidableField: (field: string) => boolean
): boolean {
  const { field } = clause
  if (!isDecidableField(field)) return false
  const single: SubBlockCondition = { field, value: clause.value, not: clause.not }
  if (evaluateSubBlockCondition(single, values)) return false
  const stored = values[field]
  const options = Array.isArray(clause.value) ? clause.value : [clause.value]
  const alternate = options.every((option) => typeof option === 'string')
    ? String(stored)
    : decodeScalar(stored)
  return alternate === stored || !evaluateSubBlockCondition(single, { [field]: alternate })
}

/**
 * Resolves a function condition, or `null` when it read a field the row cannot decide. A function
 * condition names one field in what it returns but may branch on others (Video Generator gates a
 * setting on the model, which the model itself supplies at call time), so every read is watched.
 */
function resolveFunctionCondition(
  condition: (values?: Record<string, unknown>) => SubBlockCondition,
  values: Record<string, unknown>,
  isDecidableField: (field: string) => boolean
): SubBlockCondition | null {
  let readUndecidedField = false
  const watched = new Proxy(values, {
    get(target, key, receiver) {
      if (typeof key === 'string' && !isDecidableField(key)) readUndecidedField = true
      return Reflect.get(target, key, receiver)
    },
    has(target, key) {
      if (typeof key === 'string' && !isDecidableField(key)) readUndecidedField = true
      return Reflect.has(target, key)
    },
    ownKeys(target) {
      readUndecidedField = true
      return Reflect.ownKeys(target)
    },
  })
  const resolved = condition(watched)
  return readUndecidedField ? null : resolved
}

function isCredentialSubBlock(subBlock: ConditionSubBlock): boolean {
  return (
    subBlock.type === 'oauth-input' ||
    subBlock.canonicalParamId === 'oauthCredential' ||
    subBlock.password === true
  )
}

function isConditionHidden(
  subBlock: ConditionSubBlock,
  values: Record<string, unknown>,
  isDecidableField: (field: string) => boolean
): boolean {
  if (isCredentialSubBlock(subBlock) || !subBlock.condition || subBlock.reactiveCondition) {
    return false
  }
  let condition: SubBlockCondition | null
  try {
    condition =
      typeof subBlock.condition === 'function'
        ? resolveFunctionCondition(subBlock.condition, values, isDecidableField)
        : subBlock.condition
  } catch {
    return false
  }
  if (!condition) return false
  const clauses = condition.and ? [condition, condition.and] : [condition]
  return clauses.some((clause) => isClauseFalse(clause, values, isDecidableField))
}

/**
 * Every sub-block that stores a value under `paramId`: those whose id or canonical id it is,
 * widened to the whole basic/advanced group, since either member may hold the group's value.
 */
function getWritingSubBlocks(subBlocks: ConditionSubBlock[], paramId: string): ConditionSubBlock[] {
  const groups = new Set<string>()
  for (const subBlock of subBlocks) {
    if (
      (subBlock.id === paramId || subBlock.canonicalParamId === paramId) &&
      subBlock.canonicalParamId
    ) {
      groups.add(subBlock.canonicalParamId)
    }
  }
  return subBlocks.filter(
    (subBlock) =>
      subBlock.id === paramId ||
      (subBlock.canonicalParamId !== undefined && groups.has(subBlock.canonicalParamId))
  )
}

/**
 * Drops stored tool-row values the selected operation hides.
 *
 * A tool row keeps values across operation switches, but renders only the sub-blocks whose
 * `condition` holds for the selected operation. A value left by a previous operation is then
 * invisible to the user, and because it counts as user-provided it is also withheld from the
 * model's schema, yet it still reaches the block mapper and the tool. A value is dropped only
 * when every sub-block that writes it is decidably hidden under `{ ...params, operation }`.
 *
 * Kept: values no sub-block writes (pure tool params), values any writing sub-block shows (a
 * canonical pair counts as shown when any member is), credential and password fields, and any
 * value whose condition depends on a field the row has no decidable value for. Returns `params`
 * itself when nothing is dropped.
 */
export function omitConditionHiddenParams<T>(
  subBlocks: ConditionSubBlock[] | undefined,
  params: Record<string, T>,
  operation: string | undefined
): Record<string, T> {
  if (!subBlocks?.length) return params
  const values: Record<string, unknown> = { ...params, operation }
  const operationKnown = Boolean(operation && isBlockOperation(subBlocks, operation, values))
  const isDecidableField = (field: string) =>
    field === 'operation' ? operationKnown : isDecidableValue(values[field])
  const isHidden = (paramId: string, value: T): boolean => {
    if (paramId === 'operation' || !isNonEmptyValue(value)) return false
    const writers = getWritingSubBlocks(subBlocks, paramId)
    return (
      writers.length > 0 &&
      writers.every((subBlock) => isConditionHidden(subBlock, values, isDecidableField))
    )
  }
  const entries = Object.entries(params)
  const kept = entries.filter(([paramId, value]) => !isHidden(paramId, value))
  return kept.length === entries.length ? params : Object.fromEntries(kept)
}
