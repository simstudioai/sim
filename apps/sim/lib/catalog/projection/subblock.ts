import type { SubBlockConfig } from '@/blocks/types'
import { DYNAMIC_MODEL_PROVIDERS, getHostedModels, PROVIDER_DEFINITIONS } from '@/providers/models'
import { useProvidersStore } from '@/stores/providers'

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
  /**
   * Model options only: whether Sim runs the model with its own key on a hosted
   * deployment, so the author need not supply a provider API key for it.
   */
  hosted?: boolean
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
  /**
   * Whether the field must always be supplied. A field whose requirement
   * depends on other values reports `false` and carries `requiredWhen`.
   */
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
 * Whether a condition gates its field on the selected operation.
 *
 * An operation gate is not a conditional requirement: the detail projection
 * files such a field under the operation that reveals it, where it is required
 * outright. Mirrors `operationGate` in `block-detail`.
 */
function isOperationGate(condition: CatalogCondition): boolean {
  return condition.field === 'operation' && !condition.not
}

/**
 * Whether a field is required, and under what condition.
 *
 * Two authored shapes mean "required only sometimes", and both resolve to
 * `required: false` plus the clause that decides it, never the raw object or
 * function, which is not serializable:
 *
 * - `required` declared as a condition, which shares its shape with `condition`.
 * - `required: true` on a field that only *applies* under a `condition` other
 *   than an operation gate. The agent block's `apiKey` is required, but only
 *   for a model the platform does not host; `bedrockAccessKeyId` only for a
 *   Bedrock model; `conversationId` only with memory enabled. Publishing those
 *   as `required: true` told a caller reading the block that every one of them
 *   had to be supplied on every agent.
 */
function normalizeRequired(
  required: SubBlockConfig['required'],
  condition: CatalogCondition | undefined
): {
  required?: boolean
  requiredWhen?: CatalogCondition
} {
  if (required === undefined) return {}
  if (typeof required === 'boolean') {
    if (required && condition && !isOperationGate(condition)) {
      return { required: false, requiredWhen: condition }
    }
    return { required }
  }
  const requiredWhen = typeof required === 'function' ? required() : required
  return { required: false, requiredWhen }
}

/** Whether a field is a model picker: the `model` field whose options come from a function. */
function isModelPickerField(subBlock: SubBlockConfig): boolean {
  return subBlock.id === 'model' && typeof subBlock.options === 'function'
}

/**
 * Marks the options a hosted deployment runs on the platform's own keys.
 *
 * Published only on model pickers, where it answers the question an author
 * has when choosing a model — "do I need to bring an API key for this one?" —
 * which the block otherwise expresses only through `apiKey`'s condition.
 */
function markHostedModels(options: CatalogSubBlockOption[]): CatalogSubBlockOption[] {
  const hosted = new Set(getHostedModels().map((id) => id.toLowerCase()))
  return options.map((option) =>
    hosted.has(option.id.toLowerCase()) ? { ...option, hosted: true } : option
  )
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
    if (DYNAMIC_MODEL_PROVIDER_IDS.has(provider.id)) continue
    for (const model of provider.models ?? []) {
      if (model.sunset?.status === 'deprecated') continue
      models.push({ id: model.id, label: model.id })
    }
  }
  return models
}

/**
 * Providers whose model list is fetched at runtime rather than declared in code.
 *
 * Derived from the canonical list rather than restated: the local copy had
 * drifted by one member (`litellm`), and a projection that disagrees with the
 * registry about which providers are dynamic answers a different question than
 * the app does.
 */
const DYNAMIC_MODEL_PROVIDER_IDS = new Set<string>(DYNAMIC_MODEL_PROVIDERS)

/** Shape of the providers store this projection substitutes while resolving options. */
interface ProvidersStateLike {
  providers: Record<string, { models: string[] }>
}

type ProvidersState = ReturnType<typeof useProvidersStore.getState>

/**
 * Thrown when an options function breaks the synchronous precondition below.
 *
 * Deliberately its own class so `resolveSubBlockOptions` re-throws it instead of
 * degrading it to "no options": every registered block's options run through the
 * `catalog-sweep` test, so this surfaces as a CI failure rather than a field that
 * quietly stops publishing its choices.
 */
export class AsyncOptionsFunctionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AsyncOptionsFunctionError'
  }
}

/**
 * Calls a dynamic options function with static provider data substituted for the
 * client store it would otherwise read.
 *
 * The model dropdowns read `useProvidersStore`, which has no state outside the
 * browser. Substituting the code-defined model list is what lets a server-side
 * projection publish the same options a user sees, instead of an empty list.
 *
 * PRECONDITION: every options function is synchronous, and this is the only
 * reason the substitution is safe. `useProvidersStore` is a process-global, and
 * `getState` is swapped for the duration of the call — so the window in which
 * one caller's substitute state is visible to every other caller is exactly the
 * synchronous body of `optionsFn`. An options function that awaited anything
 * would widen that window across the event loop and hand its stub to unrelated
 * requests. The substitution cannot be passed as an argument instead: the
 * options functions call `getModelOptions()` in `@/blocks/utils`, which reads
 * the store directly and takes no state parameter. So the precondition is
 * enforced rather than designed away — a thenable result throws
 * {@link AsyncOptionsFunctionError}.
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

  /**
   * Swapped through the statically imported store rather than a `require` at
   * call time. The dynamic form resolved in tests and failed silently in the
   * bundled server, where the options function then read the real, empty
   * server-side store and every model picker published no options at all.
   */
  const originalGetState = useProvidersStore.getState
  // double-cast-allowed: the substitute carries only the `providers` slice the options functions read; the store's actions are never called during the synchronous body
  useProvidersStore.getState = () => substituteState as unknown as ProvidersState

  try {
    const options = optionsFn()
    if (typeof (options as { then?: unknown } | undefined)?.then === 'function') {
      throw new AsyncOptionsFunctionError(
        'A sub-block options function returned a thenable. Options functions must be ' +
          'synchronous: the providers store is substituted process-wide for the duration of ' +
          'the call, so an asynchronous one would expose its substitute state to every other ' +
          'caller. Move the I/O behind a `selectorKey` instead.'
      )
    }
    return options
  } finally {
    useProvidersStore.getState = originalGetState
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
  } catch (error) {
    if (error instanceof AsyncOptionsFunctionError) throw error
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

/**
 * Copies a `dependsOn` hint.
 *
 * The registry's own arrays are process-global and shared by every request, so a
 * projection that returned them would put mutable registry state one careless
 * consumer away from corruption. Every array this module publishes is a copy for
 * that reason.
 */
function copyDependsOn(dependsOn: NonNullable<SubBlockConfig['dependsOn']>): CatalogDependsOn {
  if (Array.isArray(dependsOn)) return [...dependsOn]
  const copied: { all?: string[]; any?: string[] } = {}
  if (dependsOn.all) copied.all = [...dependsOn.all]
  if (dependsOn.any) copied.any = [...dependsOn.any]
  return copied
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
  if (subBlock.requiredScopes) projected.requiredScopes = [...subBlock.requiredScopes]
  assignDefined(projected, 'mimeType', subBlock.mimeType)
  assignDefined(projected, 'acceptedTypes', subBlock.acceptedTypes)
  assignDefined(projected, 'multiple', subBlock.multiple)
  assignDefined(projected, 'maxSize', subBlock.maxSize)
  assignDefined(projected, 'connectionDroppable', subBlock.connectionDroppable)
  if (subBlock.columns) projected.columns = [...subBlock.columns]
  if (subBlock.dependsOn) projected.dependsOn = copyDependsOn(subBlock.dependsOn)

  const condition = normalizeCondition(subBlock.condition)
  if (condition !== undefined) projected.condition = condition

  const { required, requiredWhen } = normalizeRequired(subBlock.required, condition)
  assignDefined(projected, 'required', required)
  assignDefined(projected, 'requiredWhen', requiredWhen)

  if (typeof subBlock.value === 'function') projected.hasComputedDefault = true

  /**
   * A model picker always publishes its choices: when its options function
   * yields nothing — the failure that left an agent grepping the raw block
   * definition for model ids — the code-defined model list stands in for it.
   */
  const resolved = resolveSubBlockOptions(subBlock)
  if (isModelPickerField(subBlock)) {
    projected.options = markHostedModels(resolved ?? staticModelOptions())
  } else if (resolved) {
    projected.options = resolved
  }

  return projected
}
