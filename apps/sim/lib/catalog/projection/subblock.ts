import type { SubBlockConfig } from '@/blocks/types'
import { PROVIDER_DEFINITIONS } from '@/providers/models'

/**
 * Surface-neutral projection of a block's sub-block (its configuration fields)
 * down to plain, serializable data.
 *
 * Pure by construction: no auth, no database, no `next/server`, and no
 * `@/tools/registry`. Both the public catalog API and the Copilot
 * `get_blocks_metadata` tool read a block's shape through here, so the two can
 * never describe the same field differently.
 */

/** One selectable option on a dropdown, combobox, or multi-select field. */
export interface CatalogSubBlockOption {
  id: string
  label?: string
  /** Whether the option renders with an icon. The icon component itself is never published. */
  hasIcon?: boolean
}

/** Scalar a condition compares against. */
export type CatalogConditionValue = string | number | boolean | Array<string | number | boolean>

/**
 * A resolved visibility or requirement condition on a sub-block: "this field
 * applies when `field` holds `value`".
 */
export interface CatalogCondition {
  field: string
  value: CatalogConditionValue
  /** When true, the condition matches every value EXCEPT `value`. */
  not?: boolean
  /** A second clause that must hold as well. */
  and?: {
    field: string
    value: CatalogConditionValue | undefined
    not?: boolean
  }
}

/** Declarative dependency hint: which sibling fields must hold a value. */
export type CatalogDependsOn = string[] | { all?: string[]; any?: string[] }

/** A block configuration field, projected to serializable data. */
export interface CatalogSubBlock {
  id: string
  type: string
  title?: string
  /** Whether the field must be supplied. A conditionally-required field reports `true`. */
  required?: boolean
  /** The condition under which the field is required, when requirement is conditional. */
  requiredWhen?: CatalogCondition
  description?: string
  placeholder?: string
  mode?: string
  hidden?: boolean
  /** The condition under which the field applies at all. */
  condition?: CatalogCondition
  options?: CatalogSubBlockOption[]
  min?: number
  max?: number
  step?: number
  integer?: boolean
  rows?: number
  password?: boolean
  multiSelect?: boolean
  language?: string
  generationType?: string
  serviceId?: string
  requiredScopes?: string[]
  mimeType?: string
  acceptedTypes?: string
  multiple?: boolean
  maxSize?: number
  connectionDroppable?: boolean
  columns?: string[]
  dependsOn?: CatalogDependsOn
  canonicalParamId?: string
  defaultValue?: string | number | boolean | Record<string, unknown> | Array<unknown>
  /**
   * Whether the field derives its value from the block's other values rather
   * than holding one of its own. The deriving function is never published.
   */
  hasComputedDefault?: boolean
}

/**
 * Resolves a condition to plain data, evaluating the function form.
 *
 * The function form is declared `(values?: Record<string, unknown>) => …`, so
 * calling it with no arguments is exactly what its signature permits. It is
 * deliberately NOT wrapped in a `try`/`catch`: a condition that dereferences
 * `values` without guarding it is a block-authoring bug, and swallowing it here
 * would drop the field's condition silently on every surface. `block-detail`'s
 * registry sweep asserts no registered block has one.
 */
export function normalizeCondition(
  condition: SubBlockConfig['condition']
): CatalogCondition | undefined {
  if (!condition) return undefined
  return typeof condition === 'function' ? condition() : condition
}

/**
 * Whether a field is required, and under what condition.
 *
 * `required` shares the condition shape with `condition`, so a conditionally
 * required field resolves to `required: true` plus the clause that decides it —
 * never the raw object or function, which is not serializable.
 */
function normalizeRequired(required: SubBlockConfig['required']): {
  required?: boolean
  requiredWhen?: CatalogCondition
} {
  if (required === undefined) return {}
  if (typeof required === 'boolean') return { required }
  const requiredWhen = typeof required === 'function' ? required() : required
  return { required: true, requiredWhen }
}

/**
 * Models offered as static dropdown options when no provider store is available.
 *
 * Providers whose model list is fetched at runtime are skipped — a catalog must
 * not publish an option set it cannot know — and retired models are excluded so
 * a caller never receives one whose API calls fail.
 */
function staticModelOptions(): CatalogSubBlockOption[] {
  const models: CatalogSubBlockOption[] = []
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    if (DYNAMIC_MODEL_PROVIDERS.has(provider.id)) continue
    for (const model of provider.models ?? []) {
      if (model.sunset?.status === 'deprecated') continue
      models.push({ id: model.id, label: model.id })
    }
  }
  return models
}

/** Providers whose model list is fetched at runtime rather than declared in code. */
const DYNAMIC_MODEL_PROVIDERS = new Set([
  'ollama',
  'ollama-cloud',
  'vllm',
  'openrouter',
  'fireworks',
  'together',
  'baseten',
])

/** Shape of the providers store this projection substitutes while resolving options. */
interface ProvidersStateLike {
  providers: Record<string, { models: string[] }>
}

/**
 * Calls a dynamic options function with static provider data substituted for the
 * client store it would otherwise read.
 *
 * The model dropdowns read `useProvidersStore`, which has no state outside the
 * browser. Substituting the code-defined model list is what lets a server-side
 * projection publish the same options a user sees, instead of an empty list.
 */
function callOptionsWithFallback(
  optionsFn: () => CatalogSubBlockOption[]
): CatalogSubBlockOption[] | undefined {
  const staticModels = staticModelOptions()
  const substituteState: ProvidersStateLike = {
    providers: {
      base: { models: staticModels.map((model) => model.id) },
      ...Object.fromEntries([...DYNAMIC_MODEL_PROVIDERS].map((id) => [id, { models: [] }])),
      litellm: { models: [] },
    },
  }

  let store: { useProvidersStore?: { getState: () => unknown } } | undefined
  let originalGetState: (() => unknown) | undefined

  try {
    store = require('@/stores/providers')
    if (store?.useProvidersStore?.getState) {
      originalGetState = store.useProvidersStore.getState
      store.useProvidersStore.getState = () => substituteState
    }
  } catch {
    /* The store module is unavailable in this environment; the fallback stands alone. */
  }

  try {
    return optionsFn()
  } finally {
    if (store?.useProvidersStore && originalGetState) {
      store.useProvidersStore.getState = originalGetState
    }
  }
}

/**
 * Resolves a field's selectable options, or `undefined` when it has none the
 * catalog can know.
 *
 * A `selectorKey` field fetches its options from a live API per workspace, so it
 * has no static option set to publish. An options *function* is called, and a
 * failure yields no options rather than propagating: unlike `condition`, these
 * functions legitimately reach for client state that may not exist.
 */
export function resolveSubBlockOptions(
  subBlock: SubBlockConfig
): CatalogSubBlockOption[] | undefined {
  let rawOptions: SubBlockConfig['options']
  try {
    rawOptions =
      typeof subBlock.options === 'function'
        ? (callOptionsWithFallback(subBlock.options as () => CatalogSubBlockOption[]) as
            | SubBlockConfig['options']
            | undefined)
        : subBlock.options
  } catch {
    return undefined
  }

  if (!Array.isArray(rawOptions) || rawOptions.length === 0) return undefined

  const normalized: CatalogSubBlockOption[] = []
  for (const option of rawOptions) {
    if (!option || option.id === undefined || option.id === null) continue
    const projected: CatalogSubBlockOption = { id: String(option.id) }
    if (typeof option.label === 'string') projected.label = option.label
    if (option.icon) projected.hasIcon = true
    normalized.push(projected)
  }

  return normalized.length > 0 ? normalized : undefined
}

/** Assigns `key` only when `value` is neither `undefined` nor `null`. */
function assignDefined<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): void {
  if (value !== undefined && value !== null) target[key] = value
}

/** Projects one sub-block config down to serializable catalog data. */
export function projectSubBlock(subBlock: SubBlockConfig): CatalogSubBlock {
  const projected: CatalogSubBlock = { id: subBlock.id, type: subBlock.type }

  assignDefined(projected, 'title', subBlock.title)
  assignDefined(projected, 'description', subBlock.description)
  assignDefined(projected, 'placeholder', subBlock.placeholder)
  assignDefined(projected, 'mode', subBlock.mode)
  assignDefined(projected, 'hidden', subBlock.hidden)
  assignDefined(projected, 'canonicalParamId', subBlock.canonicalParamId)
  assignDefined(projected, 'defaultValue', subBlock.defaultValue)
  assignDefined(projected, 'min', subBlock.min)
  assignDefined(projected, 'max', subBlock.max)
  assignDefined(projected, 'step', subBlock.step)
  assignDefined(projected, 'integer', subBlock.integer)
  assignDefined(projected, 'rows', subBlock.rows)
  assignDefined(projected, 'password', subBlock.password)
  assignDefined(projected, 'multiSelect', subBlock.multiSelect)
  assignDefined(projected, 'language', subBlock.language)
  assignDefined(projected, 'generationType', subBlock.generationType)
  assignDefined(projected, 'serviceId', subBlock.serviceId)
  assignDefined(projected, 'requiredScopes', subBlock.requiredScopes)
  assignDefined(projected, 'mimeType', subBlock.mimeType)
  assignDefined(projected, 'acceptedTypes', subBlock.acceptedTypes)
  assignDefined(projected, 'multiple', subBlock.multiple)
  assignDefined(projected, 'maxSize', subBlock.maxSize)
  assignDefined(projected, 'connectionDroppable', subBlock.connectionDroppable)
  assignDefined(projected, 'columns', subBlock.columns)
  assignDefined(projected, 'dependsOn', subBlock.dependsOn)

  const { required, requiredWhen } = normalizeRequired(subBlock.required)
  assignDefined(projected, 'required', required)
  assignDefined(projected, 'requiredWhen', requiredWhen)

  const condition = normalizeCondition(subBlock.condition)
  if (condition !== undefined) projected.condition = condition

  if (typeof subBlock.value === 'function') projected.hasComputedDefault = true

  const options = resolveSubBlockOptions(subBlock)
  if (options) projected.options = options

  return projected
}
