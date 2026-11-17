/**
 * The one evaluator of subBlock visibility over catalog data: a data condition is evaluated the way
 * the editor does (`evaluateSubBlockCondition`), and a function condition the catalog could only
 * mark `{ opaque: true }` is decided by the data the projection precomputed for it (`visibleFor`,
 * `visibleWhen`, `visibleForModel`). What the data cannot decide is `'undecided'`, and each caller
 * maps that to its own policy: activity counts the field as sent, compile's field checks as
 * visible (so they never warn on a field they cannot place), SDK codegen keeps it as "sometimes".
 *
 * Pure and dependency-free, so the editor's canonical index evaluates through it too.
 */

import { getOwn } from '../records'
import type { CatalogCondition, CatalogSubBlock, SubBlockConditionClause } from './types'

export type ConditionResult = boolean | 'undecided'

/**
 * A field's value as the caller knows it: `{ value }` (an unset field is `{ value: undefined }`),
 * or `undefined` when the caller cannot know it, which leaves any clause on it undecided.
 */
export type ConditionLookup = (field: string) => { value: unknown } | undefined

interface ClausePart {
  field: string
  value: unknown
  not?: boolean
}

/** The object form of a condition: a clause and at most one level of `and`, as in the registry. */
export interface ConditionClause extends ClausePart {
  and?: ClausePart
}

/** A data condition the evaluator can read: not absent, a boolean, or `{ opaque: true }`. */
export function isConditionClause(
  value: CatalogCondition | boolean | undefined
): value is SubBlockConditionClause {
  return typeof value === 'object' && 'field' in value
}

/** A function condition the projection could not evaluate (`{ opaque: true }`). */
export function isOpaqueCondition(value: CatalogCondition | boolean | undefined): boolean {
  return typeof value === 'object' && 'opaque' in value
}

/** A lookup over a record in which every field is known (absent means unset). */
export function recordLookup(values: Readonly<Record<string, unknown>>): ConditionLookup {
  return (field) => ({ value: values[field] })
}

function partHolds(clause: ClausePart, lookup: ConditionLookup): ConditionResult {
  const known = lookup(clause.field)
  if (!known) return 'undecided'
  const actual = known.value
  if (Array.isArray(clause.value)) {
    if (actual === undefined || actual === null) return false
    const included = (clause.value as readonly unknown[]).includes(actual)
    return clause.not ? !included : included
  }
  return clause.not ? actual !== clause.value : actual === clause.value
}

/** Evaluates a condition clause: strict equality, a list means "one of", `not` negates. */
export function evaluateClause(clause: ConditionClause, lookup: ConditionLookup): ConditionResult {
  const head = partHolds(clause, lookup)
  if (!clause.and || head === false) return head
  const tail = partHolds(clause.and, lookup)
  if (tail === false) return false
  return head === true && tail === true ? true : 'undecided'
}

/**
 * Whether a declaration is shown under the looked-up values. An opaque condition is decided:
 * - per operation by `visibleFor` (hidden when false), then by the clause `visibleWhen` still asks
 *   for that operation (none: shown);
 * - per model by `visibleForModel`, for a model the block offers as a literal option.
 * Anything else about an opaque condition is undecided.
 */
export function evaluateCondition(
  subBlock: Pick<CatalogSubBlock, 'condition' | 'visibleFor' | 'visibleWhen' | 'visibleForModel'>,
  lookup: ConditionLookup
): ConditionResult {
  const { condition, visibleFor, visibleWhen, visibleForModel } = subBlock
  if (!condition) return true
  if (!('opaque' in condition)) return evaluateClause(condition, lookup)
  const operation = lookup('operation')?.value
  if (typeof operation === 'string' && visibleFor && Object.hasOwn(visibleFor, operation)) {
    if (!visibleFor[operation]) return false
    const asked = visibleWhen && getOwn(visibleWhen, operation)
    return asked ? evaluateClause(asked, lookup) : true
  }
  const model = lookup('model')?.value
  if (typeof model === 'string' && visibleForModel && Object.hasOwn(visibleForModel, model)) {
    return visibleForModel[model] === true
  }
  return 'undecided'
}
