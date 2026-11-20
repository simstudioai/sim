import {
  type CatalogBlock,
  type CatalogBlockGraph,
  type CatalogCondition,
  type CatalogLegacyId,
  type CatalogOption,
  type CatalogOutput,
  type CatalogSubBlock,
  type CatalogTrigger,
  isJson,
  type SubBlockConditionClause,
} from '@sim/workflow-code'
import { evaluateSubBlockCondition } from '@sim/workflow-code/catalog/canonical-index'
import { isTriggerSurface } from '@sim/workflow-code/catalog/surface'
import type { OutputCondition, PrimitiveValueType } from '@sim/workflow-types/blocks'
import { isWorkflowAnnotationOnlyBlockType } from '@sim/workflow-types/workflow'
import { resolveSubBlockOptions } from '@/lib/catalog/projection/subblock'
import { getServiceConfigByServiceId } from '@/lib/oauth/utils'
import { UNIFIED_START_OUTPUTS } from '@/lib/workflows/blocks/start-outputs'
import { probeThunk, readsOnly } from '@/lib/workflows/code/catalog/probe'
import { operationOptions } from '@/lib/workflows/code/catalog/sdk-names'
import { deriveValueShape } from '@/lib/workflows/code/catalog/value-kind'
import {
  CANONICAL_ID_MIGRATIONS,
  SUBBLOCK_ID_MIGRATIONS,
} from '@/lib/workflows/migrations/subblock-migrations'
import { TRIGGER_TYPES } from '@/lib/workflows/triggers/types'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import {
  isHumanInTheLoopBlock,
  isMetadataOnlyBlockType,
  isSentinelBlockType,
} from '@/executor/constants'
import { getToolOutputsMetadata } from '@/tools/metadata-outputs'
import { getSubBlockValueShape } from '@/tools/param-shape'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Projects registry definitions into the catalog's pure-data shape.
 *
 * Every thunk is classified with {@link probeThunk}: one that reads no block value depends only on
 * the deployment and is evaluated here; one that reads values becomes `{ opaque: true }`. A
 * condition that reads only `operation` is additionally pre-expanded into `visibleFor`, which is
 * what the SDK codegen's visibility evaluator runs on.
 */

const OPAQUE = { opaque: true } as const

const PRIMITIVE_TYPES = new Set<string>([
  'string',
  'number',
  'boolean',
  'json',
  'array',
  'file',
  'file[]',
  'any',
])

const OPERATION_ONLY = new Set(['operation'])

type RegistryClause = Exclude<NonNullable<SubBlockConfig['condition']>, (...args: never) => unknown>

function copyClause(clause: RegistryClause): SubBlockConditionClause {
  const copy: SubBlockConditionClause = {
    field: clause.field,
    value: Array.isArray(clause.value) ? [...clause.value] : clause.value,
  }
  if (clause.not !== undefined) copy.not = clause.not
  if (clause.and) {
    copy.and = {
      field: clause.and.field,
      value: Array.isArray(clause.and.value) ? [...clause.and.value] : clause.and.value,
    }
    if (clause.and.not !== undefined) copy.and.not = clause.and.not
  }
  return copy
}

/**
 * Whether a clause is decided false by the operation alone. A clause on another field (Slack's
 * `destinationType`) is undecided, which counts as visible: the field can apply to that operation.
 */
function excludedByOperation(clause: SubBlockConditionClause, operation: string): boolean {
  const decided = (field: string, value: unknown, not: boolean | undefined): boolean | null => {
    if (field !== 'operation') return null
    const matches = Array.isArray(value) ? value.includes(operation) : value === operation
    return not ? !matches : matches
  }
  const main = decided(clause.field, clause.value, clause.not)
  const and = clause.and ? decided(clause.and.field, clause.and.value, clause.and.not) : null
  return main === false || and === false
}

type ConditionThunk = (values: Record<string, unknown>) => RegistryClause

/**
 * What a clause still asks once `operation` decided its operation parts: `null` when the
 * operation excludes it, `true` when nothing else is asked, else the clause on other fields.
 */
function residualAfterOperation(
  clause: SubBlockConditionClause,
  operation: string
): SubBlockConditionClause | true | null {
  if (excludedByOperation(clause, operation)) return null
  const and = clause.and
  if (clause.field === 'operation') {
    if (!and || and.field === 'operation') return true
    /** A head clause cannot ask for "unset", so that residual keeps the operation part, which holds. */
    if (and.value === undefined) return clause
    const rest: SubBlockConditionClause = { field: and.field, value: and.value }
    if (and.not !== undefined) rest.not = and.not
    return rest
  }
  if (and?.field === 'operation') {
    const rest: SubBlockConditionClause = { field: clause.field, value: clause.value }
    if (clause.not !== undefined) rest.not = clause.not
    return rest
  }
  return clause
}

/** What a function condition is probed with: operations, model ids and dropdown values. */
interface ConditionInputs {
  operations: readonly string[]
  /** The block's literal `model` options. */
  models: readonly string[]
  /** Each value a static dropdown can hold, `undefined` (unset) included. */
  choices: ReadonlyMap<string, ReadonlyArray<string | undefined>>
}

/** Value combinations tried per model before that model is left undecided. */
const MAX_MODEL_PROBE_VARIANTS = 16

function clauseFields(clause: SubBlockConditionClause): string[] {
  return clause.and ? [clause.field, clause.and.field] : [clause.field]
}

/**
 * Whether `thunk` shows its field for `model` whatever the dropdowns it also reads hold: `true`
 * or `false` when every combination agrees, `undefined` when they disagree or a read or returned
 * clause reaches a field the probe cannot enumerate.
 */
function visibleForModel(
  thunk: ConditionThunk,
  model: string,
  choices: ConditionInputs['choices']
): boolean | undefined {
  const outcomes = new Set<boolean>()
  let pending: Array<Record<string, unknown>> = [{ model }]
  let probes = 0
  while (pending.length > 0) {
    const next: Array<Record<string, unknown>> = []
    for (const bag of pending) {
      probes += 1
      if (probes > MAX_MODEL_PROBE_VARIANTS) return undefined
      const probe = probeThunk(thunk, bag)
      if (!probe.ok || probe.reads.has('*')) return undefined
      const unbound = [...probe.reads].find((read) => !Object.hasOwn(bag, read))
      if (unbound !== undefined) {
        const values = choices.get(unbound)
        if (!values) return undefined
        for (const value of values) next.push({ ...bag, [unbound]: value })
        continue
      }
      const clause = copyClause(probe.result)
      if (clauseFields(clause).some((field) => !Object.hasOwn(bag, field))) return undefined
      outcomes.add(evaluateSubBlockCondition(clause, bag))
    }
    pending = next
  }
  return outcomes.size === 1 ? outcomes.has(true) : undefined
}

/**
 * Per model id of the block, whether a model-dependent condition shows its field, or `undefined`
 * when the condition does not read the model. Models it cannot decide alone are left out.
 */
function projectVisibleForModel(
  thunk: ConditionThunk,
  inputs: ConditionInputs
): Record<string, boolean> | undefined {
  if (inputs.models.length === 0) return undefined
  if (!probeThunk(thunk, { model: inputs.models[0] }).reads.has('model')) return undefined
  const visible: Record<string, boolean> = {}
  for (const model of inputs.models) {
    const shown = visibleForModel(thunk, model, inputs.choices)
    if (shown !== undefined) visible[model] = shown
  }
  return Object.keys(visible).length > 0 ? visible : undefined
}

interface ProjectedCondition {
  condition: CatalogCondition
  visibleFor?: Record<string, boolean>
  visibleWhen?: Record<string, SubBlockConditionClause>
  visibleForModel?: Record<string, boolean>
}

/**
 * A function condition as data: evaluated when it reads no value; expanded per operation into
 * `visibleFor` when it reads only `operation`, with the clause on other fields each shown
 * operation still asks in `visibleWhen`; expanded per model into `visibleForModel` when it reads
 * the model. `condition` itself stays opaque for anything that reads values.
 */
function projectConditionThunk(thunk: ConditionThunk, inputs: ConditionInputs): ProjectedCondition {
  const probe = probeThunk(thunk)
  if (probe.ok && probe.reads.size === 0) return { condition: copyClause(probe.result) }
  if (inputs.operations.length === 0 || !readsOnly(probe.reads, OPERATION_ONLY)) {
    const perModel = projectVisibleForModel(thunk, inputs)
    return perModel ? { condition: OPAQUE, visibleForModel: perModel } : { condition: OPAQUE }
  }
  const visibleFor: Record<string, boolean> = {}
  const visibleWhen: Record<string, SubBlockConditionClause> = {}
  for (const operation of inputs.operations) {
    const perOperation = probeThunk(thunk, { operation })
    if (!perOperation.ok || !readsOnly(perOperation.reads, OPERATION_ONLY)) {
      return { condition: OPAQUE }
    }
    const residual = residualAfterOperation(copyClause(perOperation.result), operation)
    visibleFor[operation] = residual !== null
    if (residual !== null && residual !== true) visibleWhen[operation] = residual
  }
  return Object.keys(visibleWhen).length > 0
    ? { condition: OPAQUE, visibleFor, visibleWhen }
    : { condition: OPAQUE, visibleFor }
}

function projectRequired(
  required: NonNullable<SubBlockConfig['required']>
): boolean | CatalogCondition {
  if (typeof required === 'boolean') return required
  if (typeof required !== 'function') return copyClause(required)
  const probe = probeThunk(required as ConditionThunk)
  return probe.ok && probe.reads.size === 0 ? copyClause(probe.result) : OPAQUE
}

function copyOptions(
  options: ReadonlyArray<{ id: unknown; label?: unknown }> | undefined
): CatalogOption[] {
  const projected: CatalogOption[] = []
  for (const option of options ?? []) {
    if (option?.id === undefined || option.id === null) continue
    const id = String(option.id)
    projected.push({ id, label: typeof option.label === 'string' ? option.label : id })
  }
  return projected
}

type OptionsThunk = (params?: { values: Record<string, unknown> }) => unknown

/**
 * Static options are copied. A `selectorKey` field fetches its list per workspace, so it is
 * `dynamic`. An options function that ignores block values is a deployment-shaped list (the model
 * pickers) and is evaluated once through the shared resolver, which substitutes the code-defined
 * model list for the browser store; one that reads values stays opaque.
 */
function projectOptions(subBlock: SubBlockConfig): CatalogSubBlock['options'] {
  if (subBlock.selectorKey) return { dynamic: true }
  if (subBlock.options === undefined) return undefined
  if (typeof subBlock.options !== 'function') return copyOptions(subBlock.options)
  const optionsThunk = subBlock.options as OptionsThunk
  const probe = probeThunk((values) => optionsThunk({ values }))
  if (probe.reads.size > 0) return OPAQUE
  const resolved = resolveSubBlockOptions(subBlock)
  return resolved === undefined ? OPAQUE : copyOptions(resolved)
}

/**
 * A `value()` thunk is a constant when it reads no param and returns the same value twice (some
 * thunks mint ids, which must never be frozen into the catalog), unless its `valueScope` is the
 * viewer, which would freeze the server's environment into the catalog and its hash; anything
 * else is `computed`.
 * A computed thunk that reads params still has one creation value: canvas creation calls it with
 * no values (`createBlockFromParams`), so that result is kept as `initial` when it is JSON and
 * the same twice.
 */
function projectValueDefault(
  thunk: NonNullable<SubBlockConfig['value']>,
  scope: SubBlockConfig['valueScope']
): CatalogSubBlock['valueDefault'] {
  if (scope === 'viewer') return { computed: true }
  const first = probeThunk(thunk)
  if (!first.ok) return { computed: true }
  if (first.reads.size > 0) {
    const initial = first.result
    if (initial === undefined || initial === null || !isJson(initial)) return { computed: true }
    const second = probeThunk(thunk)
    const stable = second.ok && JSON.stringify(second.result) === JSON.stringify(initial)
    return stable ? { computed: true, initial } : { computed: true }
  }
  if (first.result === undefined) return undefined
  const second = probeThunk(thunk)
  if (!second.ok || second.result !== first.result || !isJson(first.result)) {
    return { computed: true }
  }
  return { constant: first.result }
}

function subBlockSurface(subBlock: SubBlockConfig): 'action' | 'trigger' {
  return isTriggerSurface(subBlock) ? 'trigger' : 'action'
}

interface SubBlockContext extends ConditionInputs {
  /** Whether this block has trigger-surface subBlocks, so every subBlock records its surface. */
  tagSurface: boolean
}

function assign<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | null): void {
  if (value !== undefined && value !== null) target[key] = value
}

function projectSubBlock(subBlock: SubBlockConfig, ctx: SubBlockContext): CatalogSubBlock {
  const shape = deriveValueShape(subBlock)
  const surface = subBlockSurface(subBlock)
  const projected: CatalogSubBlock = { id: subBlock.id, type: subBlock.type, ...shape }

  assign(projected, 'title', subBlock.title)
  assign(projected, 'mode', subBlock.mode)
  assign(projected, 'canonicalParamId', subBlock.canonicalParamId)
  if (ctx.tagSurface) projected.surface = surface

  if (subBlock.condition !== undefined) {
    if (typeof subBlock.condition === 'function') {
      const { condition, visibleFor, visibleWhen, visibleForModel } = projectConditionThunk(
        subBlock.condition as ConditionThunk,
        ctx
      )
      projected.condition = condition
      if (visibleFor) projected.visibleFor = visibleFor
      if (visibleWhen) projected.visibleWhen = visibleWhen
      if (visibleForModel) projected.visibleForModel = visibleForModel
    } else {
      projected.condition = copyClause(subBlock.condition)
    }
  }
  if (subBlock.required !== undefined) {
    projected.required = projectRequired(subBlock.required)
  }
  if (subBlock.dependsOn) {
    projected.dependsOn = Array.isArray(subBlock.dependsOn)
      ? { all: [...subBlock.dependsOn], any: [] }
      : { all: [...(subBlock.dependsOn.all ?? [])], any: [...(subBlock.dependsOn.any ?? [])] }
  }
  const writable = shape.valueKind !== 'none'
  if (writable && subBlock.defaultValue !== undefined && isJson(subBlock.defaultValue)) {
    projected.defaultValue = structuredClone(subBlock.defaultValue)
  }
  if (writable && typeof subBlock.value === 'function') {
    assign(projected, 'valueDefault', projectValueDefault(subBlock.value, subBlock.valueScope))
  }
  const options = projectOptions(subBlock)
  assign(projected, 'options', options)
  if (typeof subBlock.options === 'function' && Array.isArray(options)) projected.optionsVary = true

  assign(projected, 'hidden', subBlock.hidden)
  assign(projected, 'readOnly', subBlock.readOnly)
  assign(projected, 'password', subBlock.password)
  assign(projected, 'hideFromCopilot', subBlock.hideFromCopilot)
  assign(projected, 'context', subBlock.context)
  assign(projected, 'paramVisibility', subBlock.paramVisibility)
  assign(projected, 'emptyIsValid', subBlock.emptyIsValid)
  assign(projected, 'language', subBlock.language)
  if (subBlock.multiple === true || subBlock.multiSelect === true) projected.multiple = true
  const valueShape = getSubBlockValueShape({ type: subBlock.type, multiSelect: projected.multiple })
  if (valueShape !== 'string') projected.valueShape = valueShape
  assign(projected, 'min', subBlock.min)
  assign(projected, 'max', subBlock.max)
  assign(projected, 'step', subBlock.step)
  assign(projected, 'integer', subBlock.integer)
  if (subBlock.columns) projected.columns = [...subBlock.columns]
  assign(projected, 'selectorKey', subBlock.selectorKey)
  assign(projected, 'serviceId', subBlock.serviceId)
  if (subBlock.type === 'oauth-input' && subBlock.serviceId) {
    projected.credentialProviders = credentialProviders(subBlock.serviceId)
  }
  return projected
}

/**
 * The provider ids of the credentials a picker for `serviceId` lists, the way the credential
 * selector resolves them (`getProviderIdFromServiceId`, which falls back to the service id).
 */
function credentialProviders(serviceId: string): string[] {
  const service = getServiceConfigByServiceId(serviceId)
  if (!service) return [serviceId]
  const ids = [
    service.providerId,
    service.serviceAccountProviderId,
    ...(service.additionalProviderIds ?? []),
  ]
  return [...new Set(ids.filter((id): id is string => typeof id === 'string'))]
}

function primitiveType(type: unknown): PrimitiveValueType {
  if (type === 'object') return 'json'
  return typeof type === 'string' && PRIMITIVE_TYPES.has(type)
    ? (type as PrimitiveValueType)
    : 'any'
}

const OUTPUT_META_KEYS = new Set([
  'type',
  'description',
  'condition',
  'hiddenFromDisplay',
  'nullable',
  'properties',
  'items',
])

/**
 * An output condition's `and.value` may list `undefined` for "unset" (google_forms). JSON has no
 * `undefined`, so it is written as `null`; a catalog consumer reads a listed `null` as "unset or
 * null", which is what the editor's `evaluateOutputCondition` matches for those entries.
 */
function copyOutputCondition(condition: OutputCondition): OutputCondition {
  const copy = structuredClone(condition)
  if (copy.and && Array.isArray(copy.and.value)) {
    copy.and.value = copy.and.value.map((value) => (value === undefined ? null : value))
  }
  return copy
}

function projectOutputRecord(record: Record<string, unknown>): Record<string, CatalogOutput> {
  const projected: Record<string, CatalogOutput> = {}
  for (const [key, definition] of Object.entries(record)) {
    const output = projectOutput(definition)
    if (output) projected[key] = output
  }
  return projected
}

/**
 * One output definition, recursively. Block outputs are `OutputFieldDefinition`s (a type name or
 * `{ type, description, condition }`), possibly nesting plain records; trigger outputs are the
 * open, self-nesting `TriggerOutput`, where a key that is not a meta key is a nested output.
 */
function projectOutput(definition: unknown): CatalogOutput | undefined {
  if (typeof definition === 'string') return { type: primitiveType(definition) }
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return undefined
  const record = definition as Record<string, unknown>
  const typed = typeof record.type === 'string'
  const output: CatalogOutput = { type: typed ? primitiveType(record.type) : 'json' }
  if (typed && typeof record.description === 'string') output.description = record.description
  if (typed && record.condition && typeof record.condition === 'object') {
    output.condition = copyOutputCondition(record.condition as OutputCondition)
  }
  if (typed && record.hiddenFromDisplay === true) output.hiddenFromDisplay = true

  const nested: Record<string, unknown> = {}
  if (record.properties && typeof record.properties === 'object') {
    Object.assign(nested, record.properties)
  }
  for (const [key, value] of Object.entries(record)) {
    if (typed && OUTPUT_META_KEYS.has(key)) continue
    if (value && typeof value === 'object') nested[key] = value
  }
  const properties = projectOutputRecord(nested)
  if (Object.keys(properties).length > 0) output.properties = properties
  if (typed && record.items !== undefined) {
    const items = projectOutput(record.items)
    if (items) output.items = items
  }
  return output
}

/**
 * Per operation, the block outputs its tool declares and which of them it may return as `null`,
 * when the operation picks the tool (`tools.selector: 'operation'`). Kept only where that differs
 * from every block output, non-null.
 */
function projectOperationOutputs(
  block: BlockConfig,
  operations: readonly string[],
  outputNames: readonly string[]
): CatalogBlock['operationOutputs'] {
  const selectTool = block.tools.config?.tool
  if (!selectTool) return undefined
  const projected: NonNullable<CatalogBlock['operationOutputs']> = {}
  for (const operation of operations) {
    const probe = probeThunk(selectTool, { operation })
    if (!probe.ok || typeof probe.result !== 'string') continue
    const toolOutputs = getToolOutputsMetadata(probe.result)
    if (!toolOutputs) continue
    const names = outputNames.filter((name) => Object.hasOwn(toolOutputs, name))
    const nullable = names.filter((name) => toolOutputs[name]?.nullable === true)
    if (names.length === outputNames.length && nullable.length === 0) continue
    projected[operation] = nullable.length > 0 ? { names, nullable } : { names }
  }
  return Object.keys(projected).length > 0 ? projected : undefined
}

function projectTools(block: BlockConfig, operations: readonly string[]): CatalogBlock['tools'] {
  const access = [...block.tools.access]
  const selectTool = block.tools.config?.tool
  if (!selectTool) return { access, selector: 'single' }
  const accessSet = new Set(access)
  const perOperation =
    operations.length > 0 &&
    operations.every((operation) => {
      const probe = probeThunk(selectTool, { operation })
      return (
        probe.ok &&
        readsOnly(probe.reads, OPERATION_ONLY) &&
        typeof probe.result === 'string' &&
        accessSet.has(probe.result)
      )
    })
  return { access, selector: perOperation ? 'operation' : 'opaque' }
}

function projectGraph(block: BlockConfig): CatalogBlockGraph {
  const annotationOnly = isWorkflowAnnotationOnlyBlockType(block.type)
  const graph: CatalogBlockGraph = {
    canBeTarget: block.category !== 'triggers' && !annotationOnly,
    errorPort:
      block.category !== 'triggers' &&
      !annotationOnly &&
      !isSentinelBlockType(block.type) &&
      !isMetadataOnlyBlockType(block.type),
    container: null,
    annotationOnly,
  }
  const branchSubBlock = block.subBlocks.find(
    (subBlock) => subBlock.type === 'condition-input' || subBlock.type === 'router-input'
  )
  if (branchSubBlock) {
    graph.branches = {
      subBlockId: branchSubBlock.id,
      kind: branchSubBlock.type === 'condition-input' ? 'condition' : 'router',
    }
  }
  return graph
}

/**
 * Outputs derived from params at run time, mirroring `getEffectiveBlockOutputs`: the agent's
 * `responseFormat`, a table block's rows (typed by the selected table's columns), the
 * human-in-the-loop resume form, and any block whose Start-style
 * `input-format` field adds outputs. A trigger block (`category: 'triggers'`, such as the generic
 * webhook) declares that field on the trigger surface, and it still adds outputs.
 */
function projectDynamicOutputs(block: BlockConfig): CatalogBlock['dynamicOutputs'] {
  if (block.type === 'agent') return { source: 'responseFormat', param: 'responseFormat' }
  const tableSelector =
    block.category === 'triggers'
      ? undefined
      : block.subBlocks.find((subBlock) => subBlock.type === 'table-selector')
  if (tableSelector) {
    return { source: 'tableRows', param: tableSelector.canonicalParamId ?? tableSelector.id }
  }
  const inputFormat = block.subBlocks.find(
    (subBlock) =>
      subBlock.type === 'input-format' &&
      (subBlockSurface(subBlock) === 'action' || block.category === 'triggers')
  )
  if (!inputFormat) return undefined
  return isHumanInTheLoopBlock(block.type)
    ? { source: 'humanForm', param: inputFormat.id }
    : { source: 'inputFormat', param: inputFormat.id }
}

function projectLegacyIds(type: string): CatalogLegacyId[] | undefined {
  const migrations = SUBBLOCK_ID_MIGRATIONS[type]
  if (!migrations?.length) return undefined
  return migrations.map((migration) => {
    const legacy: CatalogLegacyId = {
      from: migration.from,
      to: migration.to.startsWith('_removed_') ? null : migration.to,
    }
    if (migration.whenOperation) legacy.whenOperation = [...migration.whenOperation]
    if (migration.whenValue) legacy.conditional = true
    return legacy
  })
}

/** A block's literal `model` options and static dropdown values, for model-condition probes. */
function conditionChoices(block: BlockConfig): Pick<ConditionInputs, 'models' | 'choices'> {
  let models: string[] = []
  const choices = new Map<string, ReadonlyArray<string | undefined>>()
  for (const subBlock of block.subBlocks) {
    if (subBlock.id !== 'model' && subBlock.type !== 'dropdown') continue
    const options = projectOptions(subBlock)
    if (!Array.isArray(options)) continue
    const ids = options.map((option) => option.id)
    if (subBlock.id === 'model') {
      if (models.length === 0) models = ids
    } else if (!choices.has(subBlock.id)) {
      choices.set(subBlock.id, [...ids, undefined])
    }
  }
  return { models, choices }
}

/**
 * The outputs a block has before its params add any, as `getBlockOutputs` resolves them: the
 * unified Start block's are built in by the runtime rather than declared on its config.
 */
function builtInOutputs(block: BlockConfig): BlockConfig['outputs'] {
  return block.type === TRIGGER_TYPES.START ? UNIFIED_START_OUTPUTS : (block.outputs ?? {})
}

/** Projects one registry block (built-in or custom) into the core-shard shape. */
export function projectBlock(block: BlockConfig): CatalogBlock {
  const operations = operationOptions(block).map((operation) => operation.id)
  const tagSurface = block.subBlocks.some((subBlock) => subBlockSurface(subBlock) === 'trigger')
  const ctx: SubBlockContext = {
    operations,
    ...conditionChoices(block),
    tagSurface,
  }

  const projected: CatalogBlock = {
    type: block.type,
    name: block.name,
    category: block.category,
    subBlocks: block.subBlocks.map((subBlock) => projectSubBlock(subBlock, ctx)),
    tools: projectTools(block, operations),
    outputs: projectOutputRecord(builtInOutputs(block)),
    graph: projectGraph(block),
  }

  const lifecycle: NonNullable<CatalogBlock['lifecycle']> = {}
  if (block.hideFromToolbar) lifecycle.hidden = true
  if (block.preview) lifecycle.preview = true
  if (block.sunset) {
    lifecycle.sunset = block.sunset.replacedBy
      ? { status: block.sunset.status, replacedBy: block.sunset.replacedBy }
      : { status: block.sunset.status }
  }
  if (projected.tools.selector === 'operation') {
    const operationOutputs = projectOperationOutputs(
      block,
      operations,
      Object.keys(projected.outputs)
    )
    if (operationOutputs) projected.operationOutputs = operationOutputs
  }
  if (Object.keys(lifecycle).length > 0) projected.lifecycle = lifecycle
  if (block.hideFromToolbar) projected.addable = false
  assign(projected, 'triggerAllowed', block.triggerAllowed)
  if (block.triggers) {
    projected.triggers = {
      enabled: block.triggers.enabled,
      available: [...block.triggers.available],
    }
  }
  assign(projected, 'singleInstance', block.singleInstance)
  const dynamicOutputs = projectDynamicOutputs(block)
  if (dynamicOutputs) projected.dynamicOutputs = dynamicOutputs
  const legacyIds = projectLegacyIds(block.type)
  if (legacyIds) projected.legacyIds = legacyIds
  const legacyCanonicalIds = CANONICAL_ID_MIGRATIONS[block.type]
  if (legacyCanonicalIds?.length) {
    projected.legacyCanonicalIds = legacyCanonicalIds.map(({ from, to }) => ({ from, to }))
  }
  if (block.sourceWorkflowId !== undefined) {
    projected.custom = { sourceWorkflowId: block.sourceWorkflowId }
  }
  return projected
}

/**
 * The two subflow containers. They live outside the block registry (the editor stores their
 * config in block `data`, which canonicalize reads into `LoopSpec` / `ParallelSpec`), so the
 * catalog declares them here to give compile one vocabulary for every placeable type.
 */
export function containerBlock(type: 'loop' | 'parallel'): CatalogBlock {
  return {
    type,
    name: type === 'loop' ? 'Loop' : 'Parallel',
    category: 'blocks',
    subBlocks: [],
    tools: { access: [], selector: 'single' },
    outputs: { results: { type: 'array' } },
    graph: { canBeTarget: true, errorPort: false, container: type, annotationOnly: false },
  }
}

/** Projects one trigger as `getTrigger()` returns it (namespaced display subBlocks). */
export function projectTrigger(trigger: TriggerConfig): CatalogTrigger {
  const ctx: SubBlockContext = {
    operations: [],
    models: [],
    choices: new Map(),
    tagSurface: false,
  }
  const projected: CatalogTrigger = {
    id: trigger.id,
    provider: trigger.provider,
    name: trigger.name,
    subBlocks: trigger.subBlocks.map((subBlock) => projectSubBlock(subBlock, ctx)),
    outputs: projectOutputRecord(trigger.outputs ?? {}),
  }
  if (trigger.polling) projected.polling = true
  if (trigger.webhook) projected.webhook = true
  return projected
}
