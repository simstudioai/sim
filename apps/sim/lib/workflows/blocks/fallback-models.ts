import { providerRequiresFamilyCredentials, shouldRequireApiKeyForModel } from '@/blocks/utils'
import {
  findProviderFromModel,
  getMaxTemperature,
  getModelCapabilities,
  getReasoningEffortValuesForModel,
  getThinkingLevelsForModel,
  getVerbosityValuesForModel,
  isAutoModel,
  isKnownModelId,
} from '@/providers/models'

/** Upper bound on fallback rows; enough for a full provider spread without an unbounded chain. */
export const MAX_FALLBACK_MODELS = 5

/** The graded tuning knobs a fallback row may set for itself. */
export const FALLBACK_TUNING_KNOBS = ['reasoningEffort', 'thinkingLevel', 'verbosity'] as const
export type FallbackTuningKnob = (typeof FALLBACK_TUNING_KNOBS)[number]

/** The "let the provider decide" entry each knob's field offers first, as the block's own fields do. */
const KNOB_SENTINEL: Record<FallbackTuningKnob, string> = {
  reasoningEffort: 'auto',
  thinkingLevel: 'none',
  verbosity: 'auto',
}

export const FALLBACK_TUNING_LABELS: Record<FallbackTuningKnob, string> = {
  reasoningEffort: 'Reasoning effort',
  thinkingLevel: 'Thinking level',
  verbosity: 'Verbosity',
}

/** Per-row tuning: present only when the builder chose a value for that knob. */
export type FallbackTuningValues = Partial<Record<FallbackTuningKnob, string>>

/**
 * One stored fallback row. `id` is a React key only. `apiKey`, when present, is
 * always a whole `{{ENV_VAR}}` reference: a raw secret nested inside a list
 * value would bypass every redaction path that keys on a top-level
 * `password: true` field, so the picker cannot produce one and the copilot
 * validator refuses one. The tuning knobs hold a value only when the primary's
 * setting could not be carried over (see `getFallbackTuningKnobsToShow`).
 */
export interface FallbackModelEntry extends FallbackTuningValues {
  id: string
  model: string
  apiKey?: string
}

/** A row the executor acts on: the React key is gone, and `apiKey` is a validated reference. */
export interface FallbackModelCandidate extends FallbackTuningValues {
  model: string
  apiKey?: string
}

const WHOLE_ENV_VAR_REFERENCE = /^\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}$/

/** Whether a value is exactly one `{{ENV_VAR}}` reference and nothing else. */
export function isWholeEnvVarReference(value: unknown): value is string {
  return typeof value === 'string' && WHOLE_ENV_VAR_REFERENCE.test(value.trim())
}

/**
 * Normalizes a stored fallback list into the ordered candidates execution walks.
 *
 * Tolerant rather than strict because it runs on every execution: rows the
 * editor could not have written (missing model, sim-auto) are dropped instead
 * of failing the block, and duplicates keep their first position so the order
 * the builder chose is preserved.
 *
 * A row's `apiKey` is kept as any non-empty string. By the time this runs the
 * input resolver has already turned the stored `{{ENV_VAR}}` reference into the
 * key itself, exactly as it does for the block's own API Key field; the
 * reference-only rule is enforced where rows are written (the picker, the
 * copilot validator) and where they leave the workspace (the export sanitizer).
 */
export function normalizeFallbackModels(raw: unknown): FallbackModelCandidate[] {
  if (!Array.isArray(raw)) return []

  const seen = new Set<string>()
  const candidates: FallbackModelCandidate[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const { model, apiKey } = row as { model?: unknown; apiKey?: unknown }
    if (typeof model !== 'string') continue
    const trimmed = model.trim()
    if (!trimmed || isAutoModel(trimmed)) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const resolvedKey = typeof apiKey === 'string' ? apiKey.trim() : ''
    candidates.push({
      model: trimmed,
      ...(resolvedKey ? { apiKey: resolvedKey } : {}),
      ...normalizeTuningValues(row as Record<string, unknown>),
    })
    if (candidates.length >= MAX_FALLBACK_MODELS) break
  }
  return candidates
}

/** The tuning knobs a row carries, trimmed and lower-cased; blanks and non-strings are dropped. */
export function normalizeTuningValues(row: Record<string, unknown>): FallbackTuningValues {
  const values: FallbackTuningValues = {}
  for (const knob of FALLBACK_TUNING_KNOBS) {
    const value = row[knob]
    const level = typeof value === 'string' ? value.trim().toLowerCase() : ''
    /** The provider-decides entry is stored as absence, the same way the editor stores it. */
    if (level && level !== KNOB_SENTINEL[knob]) values[knob] = level
  }
  return values
}

/**
 * The edits the editor makes to a fallback list, as pure transforms so the
 * component stays a thin binding and the rules are unit-testable.
 */
export function addFallbackRow(rows: FallbackModelEntry[], id: string): FallbackModelEntry[] {
  if (rows.length >= MAX_FALLBACK_MODELS) return rows
  return [...rows, { id, model: '' }]
}

export function removeFallbackRow(rows: FallbackModelEntry[], id: string): FallbackModelEntry[] {
  return rows.filter((row) => row.id !== id)
}

export function moveFallbackRow(
  rows: FallbackModelEntry[],
  id: string,
  direction: -1 | 1
): FallbackModelEntry[] {
  const index = rows.findIndex((row) => row.id === id)
  const target = index + direction
  if (index === -1 || target < 0 || target >= rows.length) return rows
  const next = [...rows]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

/**
 * A new model gets a clean row. Tuning always goes, since the new model may not
 * declare it. The key survives only when the new model still needs one and sits
 * on the same provider as the old one: a key reference is a credential for one
 * provider, and carrying it to another would send that provider's secret to an
 * unrelated service.
 */
export function changeFallbackRowModel(
  rows: FallbackModelEntry[],
  id: string,
  model: string,
  primaryModel: string
): FallbackModelEntry[] {
  return rows.map((row) => {
    if (row.id !== id) return row
    const keepKey =
      isWholeEnvVarReference(row.apiKey) &&
      fallbackRowNeedsApiKey(model, primaryModel) &&
      findProviderFromModel(model.trim()) === findProviderFromModel(row.model.trim())
    return { id: row.id, model, ...(keepKey ? { apiKey: row.apiKey } : {}) }
  })
}

export function changeFallbackRowApiKey(
  rows: FallbackModelEntry[],
  id: string,
  apiKey: string
): FallbackModelEntry[] {
  return rows.map((row) => (row.id === id ? { ...row, apiKey } : row))
}

/** The provider-decides entry is the field's default, so it is stored as absence. */
export function changeFallbackRowTuning(
  rows: FallbackModelEntry[],
  id: string,
  knob: FallbackTuningKnob,
  value: string
): FallbackModelEntry[] {
  return rows.map((row) => {
    if (row.id !== id) return row
    const { [knob]: _previous, ...rest } = row
    return value && value !== KNOB_SENTINEL[knob] ? { ...rest, [knob]: value } : rest
  })
}

/**
 * Whether a model can serve as a fallback for `primaryModel` with the
 * credentials the block can actually give it.
 *
 * A fallback resolves its key the way the primary does, through workspace BYOK,
 * the platform key, or the block's own field, with one addition: a row may name
 * a workspace variable holding its key. What it can never do is inherit a Vertex
 * credential, Bedrock keys, or an Azure endpoint from a primary in another
 * family, because those fields only render for the primary's own provider.
 */
export function isViableFallbackModel(model: string, primaryModel: string): boolean {
  const trimmed = model.trim()
  if (!trimmed || isAutoModel(trimmed)) return false
  if (trimmed.toLowerCase() === primaryModel.trim().toLowerCase()) return false

  const provider = findProviderFromModel(trimmed)
  if (!provider) return false

  if (providerRequiresFamilyCredentials(provider)) {
    return provider === findProviderFromModel(primaryModel.trim())
  }
  return true
}

/**
 * Whether a fallback row must name a workspace variable for its key.
 *
 * A model that needs a key and shares the primary's provider reuses the
 * block's own API Key field, so only a cross-provider fallback asks for one.
 */
export function fallbackRowNeedsApiKey(model: string, primaryModel: string): boolean {
  const trimmed = model.trim()
  if (!trimmed || !shouldRequireApiKeyForModel(trimmed)) return false
  const provider = findProviderFromModel(trimmed)
  return provider === null || provider !== findProviderFromModel(primaryModel.trim())
}

/**
 * The values `model` accepts for `knob`, with the provider-decides entry first,
 * exactly as the block's own field offers them. Null when the model lacks the
 * knob or is not in the catalog, which is also how the block's field decides
 * whether to render.
 */
export function getTuningOptionsForModel(model: string, knob: FallbackTuningKnob): string[] | null {
  const trimmed = model.trim()
  if (!trimmed) return null
  const declared =
    knob === 'reasoningEffort'
      ? getReasoningEffortValuesForModel(trimmed)
      : knob === 'thinkingLevel'
        ? getThinkingLevelsForModel(trimmed)
        : getVerbosityValuesForModel(trimmed)
  if (!declared) return null
  const sentinel = KNOB_SENTINEL[knob]
  return [sentinel, ...declared.filter((value) => value !== sentinel)]
}

/**
 * Whether `value` can be sent to `model` for `knob`. Unset and the sentinel
 * always can. Otherwise the model must declare it; a model the catalog does not
 * know declares nothing, so anything passes through, as it does for the primary,
 * while a catalogued model without the knob accepts nothing for it.
 */
export function isTuningValueValidForModel(
  model: string,
  knob: FallbackTuningKnob,
  value: unknown
): boolean {
  if (typeof value !== 'string') return value === undefined || value === null
  const normalized = value.trim().toLowerCase()
  if (!normalized || normalized === KNOB_SENTINEL[knob]) return true
  const options = getTuningOptionsForModel(model, knob)
  if (options === null) return !isKnownModelId(model.trim())
  return options.includes(normalized)
}

/**
 * The knobs a fallback row has to ask about: those the fallback model has that
 * the primary's current setting cannot fill, either because the primary lacks
 * the knob or because its value is not one the fallback declares. A value the
 * fallback accepts is inherited silently, so a same-family row stays bare.
 */
export function getFallbackTuningKnobsToShow(
  fallbackModel: string,
  primaryModel: string,
  primaryValues: Partial<Record<FallbackTuningKnob, unknown>>
): FallbackTuningKnob[] {
  return FALLBACK_TUNING_KNOBS.filter((knob) => {
    if (getTuningOptionsForModel(fallbackModel, knob) === null) return false
    if (getTuningOptionsForModel(primaryModel, knob) === null) return true
    return !isTuningValueValidForModel(fallbackModel, knob, primaryValues[knob])
  })
}

export interface PrimaryTuningInputs extends Partial<Record<FallbackTuningKnob, string>> {
  temperature?: string | number
  maxTokens?: string | number
}

export interface ResolvedFallbackTuning extends Partial<Record<FallbackTuningKnob, string>> {
  temperature?: string | number
  maxTokens?: string | number
  /** Human-readable notes on every value that differs from the primary's, for the run log. */
  adjustments: string[]
}

function clampToCap(
  value: string | number | undefined,
  cap: number | undefined
): string | number | undefined {
  if (value === undefined || value === null || value === '' || cap === undefined) return value
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= cap) return value
  return typeof value === 'number' ? cap : String(cap)
}

/**
 * The tuning a fallback candidate runs with.
 *
 * Graded knobs: the row's own value wins, but only for a knob the row is
 * currently asked about (`getFallbackTuningKnobsToShow`), so a value stored
 * while the primary was incompatible stops applying once the primary's own
 * value fits and the field is no longer shown. Otherwise the primary's value is
 * carried over only when the fallback declares it, and dropped to the
 * provider's default otherwise, which is what the row field exists to override.
 * Temperature and max output tokens are caps in the primary's terms, so they
 * are clamped to what the fallback allows rather than dropped: a low
 * temperature chosen for repeatability must survive, and "no more than N" still
 * holds under a smaller ceiling. A fallback the catalog does not know has no
 * caps and no lists, so everything passes through to it unchanged. A primary
 * the catalog does not know never showed a graded knob in the editor, so a
 * value stored under it is stale and is not inherited; the row shows the field
 * instead, and its own value is what applies.
 */
export function resolveFallbackTuning(
  candidate: FallbackModelCandidate,
  primaryModel: string,
  primary: PrimaryTuningInputs
): ResolvedFallbackTuning {
  const adjustments: string[] = []
  const resolved: ResolvedFallbackTuning = { adjustments }
  const overridable = new Set(getFallbackTuningKnobsToShow(candidate.model, primaryModel, primary))

  for (const knob of FALLBACK_TUNING_KNOBS) {
    const own = overridable.has(knob) ? candidate[knob] : undefined
    if (own) {
      resolved[knob] = own
      if (own !== primary[knob]) adjustments.push(`${knob}: ${primary[knob] ?? 'unset'} -> ${own}`)
      continue
    }
    const inherit =
      getTuningOptionsForModel(primaryModel, knob) !== null &&
      isTuningValueValidForModel(candidate.model, knob, primary[knob])
    resolved[knob] = inherit ? primary[knob] : undefined
    if (!inherit && primary[knob]) adjustments.push(`${knob}: ${primary[knob]} -> provider default`)
  }

  resolved.temperature = clampToCap(primary.temperature, getMaxTemperature(candidate.model))
  if (resolved.temperature !== primary.temperature) {
    adjustments.push(`temperature: ${primary.temperature} -> ${resolved.temperature}`)
  }
  resolved.maxTokens = clampToCap(
    primary.maxTokens,
    getModelCapabilities(candidate.model)?.maxOutputTokens
  )
  if (resolved.maxTokens !== primary.maxTokens) {
    adjustments.push(`maxTokens: ${primary.maxTokens} -> ${resolved.maxTokens}`)
  }

  return resolved
}

/** "2nd choice", "3rd choice", ... for the row at `index` (0-based) below the primary. */
export function ordinalChoiceLabel(index: number): string {
  const n = index + 2
  const mod100 = n % 100
  const suffix =
    mod100 >= 11 && mod100 <= 13
      ? 'th'
      : n % 10 === 1
        ? 'st'
        : n % 10 === 2
          ? 'nd'
          : n % 10 === 3
            ? 'rd'
            : 'th'
  return `${n}${suffix} choice`
}
