/**
 * The three-way visibility evaluator.
 *
 * For one builder (an operation, or a trigger mode), every candidate subBlock is evaluated against
 * the builder's pinned values (`operation` and `fixed`) and every combination of the static
 * siblings its conditions read: dropdowns with a static option list, and switches. Combinations
 * are capped at {@link MAX_COMBINATIONS}; the widest siblings stop being enumerated first. A field
 * nobody enumerates is unknown, so a condition on it is "sometimes".
 *
 * Conditions are evaluated by the catalog's one evaluator (`@sim/workflow-code/catalog/conditions`).
 */

import { compareStrings } from '@sim/utils/string'
import type { CatalogSubBlock } from '@sim/workflow-code'
import {
  type ConditionClause,
  type ConditionLookup,
  type ConditionResult,
  evaluateClause as evaluateCatalogClause,
  evaluateCondition,
  isConditionClause,
  isOpaqueCondition,
} from '@sim/workflow-code/catalog/conditions'
import { isEnumerable, typedForBuilder } from '@sim/workflow-code/catalog/surface'

const MAX_COMBINATIONS = 64

/** A dropdown with at most this many options may become one nested union level. */
const MAX_GATE_OPTIONS = 4

export type Scalar = string | number | boolean

/** Three-valued truth: `null` means the answer depends on a field nobody enumerates. */
type Tri = boolean | null

interface SiblingDomain {
  field: string
  values: Scalar[]
}

export interface VisibilityContext {
  /** Values the builder pins: its `operation` and `fixed` entries. */
  pinned: Readonly<Record<string, Scalar>>
  /** Enumerated siblings, sorted by field. */
  siblings: SiblingDomain[]
  /** Every combination of sibling values (one empty combination when there are none). */
  combos: Array<Readonly<Record<string, Scalar>>>
}

export interface ParamVisibility {
  kind: 'always' | 'sometimes' | 'never'
  /** True iff the param is visible and required in every combination. */
  required: boolean
  /** Visibility per combination, aligned with `context.combos`. */
  visible: Tri[]
  /** Visible and required per combination. */
  requiredIn: boolean[]
  /** Human-readable `@when` text for a "sometimes" param. */
  when?: string
}

/** The fields a clause reads: its own, and its `and` clause's. */
export function clauseFields(clause: ConditionClause): string[] {
  return clause.and ? [clause.field, clause.and.field] : [clause.field]
}

/**
 * The sibling fields a subBlock's visibility or requirement reads under the pinned values: its
 * data clauses, and the clause a function condition still asks for the pinned operation.
 */
function referencedFields(
  subBlock: CatalogSubBlock,
  pinned: Readonly<Record<string, Scalar>>
): string[] {
  const fields: string[] = []
  if (isConditionClause(subBlock.condition)) fields.push(...clauseFields(subBlock.condition))
  if (isConditionClause(subBlock.required)) fields.push(...clauseFields(subBlock.required))
  const asked = askedForOperation(subBlock, pinned)
  if (asked) fields.push(...clauseFields(asked))
  return fields
}

function askedForOperation(
  subBlock: CatalogSubBlock,
  pinned: Readonly<Record<string, Scalar>>
): ConditionClause | undefined {
  const { operation } = pinned
  if (typeof operation !== 'string' || !subBlock.visibleWhen) return undefined
  return Object.hasOwn(subBlock.visibleWhen, operation)
    ? subBlock.visibleWhen[operation]
    : undefined
}

function domainOf(subBlocks: readonly CatalogSubBlock[], field: string): Scalar[] | null {
  if (!isEnumerable(subBlocks, field)) return null
  const values: Scalar[] = []
  for (const subBlock of subBlocks) {
    if (subBlock.id !== field) continue
    const domain: Scalar[] =
      subBlock.type === 'switch'
        ? [true, false]
        : Array.isArray(subBlock.options)
          ? subBlock.options.map((option) => option.id)
          : []
    for (const value of domain) if (!values.includes(value)) values.push(value)
  }
  return values
}

function product(domains: readonly SiblingDomain[]): number {
  return domains.reduce((total, domain) => total * domain.values.length, 1)
}

function byField(a: SiblingDomain, b: SiblingDomain): number {
  return compareStrings(a.field, b.field)
}

/**
 * Builds the evaluation context for one builder: which siblings to enumerate and every
 * combination of their values.
 */
export function buildVisibilityContext(
  candidates: readonly CatalogSubBlock[],
  pinned: Readonly<Record<string, Scalar>>
): VisibilityContext {
  const fields = new Set<string>()
  for (const subBlock of candidates) {
    for (const field of referencedFields(subBlock, pinned)) {
      if (!(field in pinned)) fields.add(field)
    }
  }
  let siblings: SiblingDomain[] = []
  for (const field of fields) {
    const values = domainOf(candidates, field)
    if (values) siblings.push({ field, values })
  }
  siblings.sort(byField)
  while (product(siblings) > MAX_COMBINATIONS) {
    const widest = [...siblings].sort(
      (a, b) => b.values.length - a.values.length || byField(a, b)
    )[0]
    siblings = siblings.filter((sibling) => sibling !== widest)
  }
  let combos: Array<Record<string, Scalar>> = [{}]
  for (const sibling of siblings) {
    combos = combos.flatMap((combo) =>
      sibling.values.map((value) => ({ ...combo, [sibling.field]: value }))
    )
  }
  return { pinned, siblings, combos }
}

function comboLookup(
  context: VisibilityContext,
  combo: Readonly<Record<string, Scalar>>
): ConditionLookup {
  return (field) => {
    if (field in context.pinned) return { value: context.pinned[field] }
    if (field in combo) return { value: combo[field] }
    return undefined
  }
}

function toTri(result: ConditionResult): Tri {
  return result === 'undecided' ? null : result
}

/** Evaluates a condition clause; `null` when it reads a field that is not known. */
export function evaluateClause(
  clause: ConditionClause,
  context: VisibilityContext,
  combo: Readonly<Record<string, Scalar>>
): Tri {
  return toTri(evaluateCatalogClause(clause, comboLookup(context, combo)))
}

/**
 * Visibility in one combination. A function condition is decided by the data the catalog
 * precomputed for the pinned operation (`visibleFor`, then the `visibleWhen` clause on siblings);
 * without that data it is unknown.
 */
function visibleIn(
  subBlock: CatalogSubBlock,
  context: VisibilityContext,
  combo: Readonly<Record<string, Scalar>>
): Tri {
  return toTri(evaluateCondition(subBlock, comboLookup(context, combo)))
}

function requiredIn(
  subBlock: CatalogSubBlock,
  context: VisibilityContext,
  combo: Readonly<Record<string, Scalar>>
): boolean {
  const { required } = subBlock
  if (required === true) return true
  if (isConditionClause(required)) return evaluateClause(required, context, combo) === true
  return false
}

function describeWhen(
  members: readonly CatalogSubBlock[],
  context: VisibilityContext,
  visible: readonly Tri[]
): string {
  const parts: string[] = []
  for (const sibling of context.siblings) {
    const seen = new Set<Scalar>()
    context.combos.forEach((combo, index) => {
      if (visible[index] !== false) seen.add(combo[sibling.field])
    })
    if (seen.size < sibling.values.length) {
      const values = sibling.values.filter((value) => seen.has(value))
      parts.push(`${sibling.field} is ${values.map((value) => JSON.stringify(value)).join(' | ')}`)
    }
  }
  if (visible.includes(null)) {
    const unknown = new Set<string>()
    let opaque = false
    for (const member of members) {
      const clause = isConditionClause(member.condition)
        ? member.condition
        : askedForOperation(member, context.pinned)
      if (clause) {
        for (const field of clauseFields(clause)) {
          if (!(field in context.pinned) && !context.siblings.some((s) => s.field === field)) {
            unknown.add(field)
          }
        }
      } else if (isOpaqueCondition(member.condition)) {
        opaque = true
      }
    }
    if (unknown.size > 0) parts.push(`depends on ${[...unknown].sort(compareStrings).join(', ')}`)
    if (opaque) parts.push('depends on other fields')
  }
  return parts.join('; ')
}

/**
 * Classifies one param (one subBlock, a basic/advanced pair, or a duplicated id) across every
 * combination: visible in a combination iff any member is. It is `never` exactly when the
 * builder's pinned values alone hide every member (`typedForBuilder`), the rule print and compile
 * use to place a stored value outside the builder's params.
 */
export function classifyParam(
  members: readonly CatalogSubBlock[],
  context: VisibilityContext
): ParamVisibility {
  const visible: Tri[] = []
  const required: boolean[] = []
  for (const combo of context.combos) {
    let anyTrue = false
    let anyUnknown = false
    let isRequired = false
    for (const member of members) {
      const memberVisible = visibleIn(member, context, combo)
      if (memberVisible === true) {
        anyTrue = true
        if (requiredIn(member, context, combo)) isRequired = true
      } else if (memberVisible === null) {
        anyUnknown = true
      }
    }
    visible.push(anyTrue ? true : anyUnknown ? null : false)
    required.push(isRequired)
  }
  const kind = !typedForBuilder(members, context.pinned)
    ? 'never'
    : visible.every((value) => value === true)
      ? 'always'
      : 'sometimes'
  return {
    kind,
    required: kind === 'always' && required.every(Boolean),
    visible,
    requiredIn: required,
    when: kind === 'sometimes' ? describeWhen(members, context, visible) : undefined,
  }
}

interface GateVariant {
  /** The gate values this variant covers (variants with identical fields are merged). */
  values: Scalar[]
  /** Gated params visible for these values, and whether each is required there. */
  params: Array<{ name: string; required: boolean }>
}

export interface Gate {
  field: string
  variants: GateVariant[]
}

/**
 * Finds the one sibling dropdown (at most {@link MAX_GATE_OPTIONS} options, itself always
 * visible) whose value alone decides the visibility of the most "sometimes" params, so the params
 * type becomes one nested union level keyed on it. Returns `null` when no sibling gates anything.
 */
export function findGate(
  params: ReadonlyArray<{ name: string; visibility: ParamVisibility }>,
  context: VisibilityContext,
  alwaysVisibleFields: ReadonlySet<string>
): Gate | null {
  let best: { field: string; gated: string[] } | null = null
  for (const sibling of context.siblings) {
    if (sibling.values.length > MAX_GATE_OPTIONS || sibling.values.length < 2) continue
    if (typeof sibling.values[0] !== 'string') continue
    if (!alwaysVisibleFields.has(sibling.field)) continue
    const gated: string[] = []
    for (const param of params) {
      if (param.visibility.kind !== 'sometimes' || param.name === sibling.field) continue
      if (isDecidedBy(param.visibility, context, sibling)) gated.push(param.name)
    }
    if (gated.length > 0 && (!best || gated.length > best.gated.length)) {
      best = { field: sibling.field, gated }
    }
  }
  if (!best) return null
  const gate = best
  const sibling = context.siblings.find((candidate) => candidate.field === gate.field)
  if (!sibling) return null
  const variants: GateVariant[] = []
  for (const value of sibling.values) {
    const indices = indicesWhere(context, sibling.field, value)
    const variantParams: GateVariant['params'] = []
    for (const name of gate.gated) {
      const param = params.find((candidate) => candidate.name === name)
      if (!param || param.visibility.visible[indices[0]] !== true) continue
      const required = indices.every((index) => param.visibility.requiredIn[index])
      variantParams.push({ name, required })
    }
    const signature = JSON.stringify(variantParams)
    const same = variants.find((variant) => JSON.stringify(variant.params) === signature)
    if (same) same.values.push(value)
    else variants.push({ values: [value], params: variantParams })
  }
  return variants.length > 1 ? { field: gate.field, variants } : null
}

function indicesWhere(context: VisibilityContext, field: string, value: Scalar): number[] {
  const indices: number[] = []
  context.combos.forEach((combo, index) => {
    if (combo[field] === value) indices.push(index)
  })
  return indices
}

function isDecidedBy(
  visibility: ParamVisibility,
  context: VisibilityContext,
  sibling: SiblingDomain
): boolean {
  for (const value of sibling.values) {
    const indices = indicesWhere(context, sibling.field, value)
    const first = visibility.visible[indices[0]]
    if (first === null) return false
    if (!indices.every((index) => visibility.visible[index] === first)) return false
  }
  return true
}
