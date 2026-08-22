import {
  normalizedStringify,
  sanitizeInputFormat,
  sanitizeTableRows,
  sanitizeTools,
} from '@/lib/workflows/comparison/normalize'

/**
 * Everything the canonical form needs to know about one declared subblock.
 * Derived from the block definition, never from stored state.
 */
export interface CanonicalFieldSpec {
  /** The declared subblock type, or the stored one when the field is undeclared. */
  type?: string
  /** Absent when the definition declares no default. Never `null` by convention. */
  defaultValue?: unknown
  /** The field declares that an explicitly empty value is a real choice. */
  emptyIsValid?: boolean
}

/**
 * Strips the presentation-only parts of a stored value.
 *
 * Rules are applied by subblock id AND by declared type, deliberately taking the
 * union: the id-keyed forms are what the comparison has always used, and the
 * type-keyed forms catch the same shape under a different field name. A value
 * can only lose presentation detail here, never gain meaning.
 */
export function shapeSubBlockValue(
  subBlockId: string,
  value: unknown,
  subBlockType: string | undefined
): unknown {
  let shaped: unknown = value ?? null

  if (Array.isArray(shaped) && (subBlockId === 'tools' || subBlockType === 'tool-input')) {
    shaped = sanitizeTools(shaped)
  }
  if (
    Array.isArray(shaped) &&
    (subBlockId === 'inputFormat' ||
      subBlockType === 'input-format' ||
      subBlockType === 'response-format')
  ) {
    shaped = sanitizeInputFormat(shaped)
  }
  if (Array.isArray(shaped) && subBlockType === 'table') {
    const rows = sanitizeTableRows(shaped)
    shaped = rows.length > 0 ? rows : null
  }

  return shaped
}

/**
 * Resolves a stored subblock value to the configuration it actually represents.
 *
 * Returns `undefined` for "this field carries no configuration" — which is what
 * a blank value and a value equal to the field's declared default both mean.
 * Collapsing them is the whole point: an unset field has four legal spellings in
 * storage (key absent, `null`, `''`, or the declared default, which deploy
 * materializes into `webhook.providerConfig`), and different pipelines pick
 * different ones. Any comparison that can tell them apart reports a change the
 * user did not make — and, because adding a defaulted field to a block
 * definition changes the spelling on one side only, does so retroactively for
 * every already-deployed workflow.
 *
 * Resolution is deliberately comparison-time only. Writing defaults into storage
 * would answer the same question, but it is a one-way migration whose rollback
 * leaves every seeded block permanently divergent, and it would destroy the
 * "key absent means this state predates the field" signal the subblock-rename
 * migrations depend on.
 *
 * `defaultValue` is consulted; `value()` deliberately is not. Value thunks are
 * generators (`() => generateId()`), so resolving one would produce a fresh
 * value per call and make a state unequal to itself.
 */
export function canonicalizeSubBlockValue(
  subBlockId: string,
  stored: unknown,
  spec: CanonicalFieldSpec | undefined
): unknown {
  const shaped = shapeSubBlockValue(subBlockId, stored, spec?.type)

  /*
   * Absent, `null` and `undefined` are one state: no consumer distinguishes
   * them, and the subblock merge contract already collapses `undefined` into
   * "no value recorded".
   */
  if (shaped === null || shaped === undefined) return undefined

  if (spec?.defaultValue === undefined) return shaped

  const shapedDefault = shapeSubBlockValue(subBlockId, spec.defaultValue, spec.type)
  if (normalizedStringify(shaped) === normalizedStringify(shapedDefault)) return undefined

  /*
   * `''` collapses only for a field that declares a default, because that is
   * exactly where the substitution happens: `getConfigValue` writes the default
   * into `webhook.providerConfig` for a blank OR empty-string value, so the two
   * are already indistinguishable in every artifact deploy produces.
   *
   * Where no default is declared, `''` stays a real value — the serializer fills
   * a subblock from its `value()` thunk on `params[id] == null`, which `''` does
   * not satisfy, so an empty string suppresses the thunk where `null` fires it.
   *
   * `emptyIsValid` opts a field out: it declares that an explicitly empty value
   * is a choice the user made, not the absence of one.
   */
  if (shaped === '' && !spec.emptyIsValid) return undefined

  return shaped
}
