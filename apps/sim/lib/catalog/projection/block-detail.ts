import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import {
  actionSubBlocks,
  type CatalogBlockSummary,
  projectBlockSummary,
  resolveOperationIds,
} from '@/lib/catalog/projection/block-summary'
import {
  type CatalogSubBlock,
  normalizeCondition,
  projectSubBlock,
} from '@/lib/catalog/projection/subblock'
import {
  type CatalogDeployment,
  type CatalogToolDetail,
  type CatalogToolOutput,
  type CatalogToolSummary,
  projectToolDetail,
} from '@/lib/catalog/projection/tool'
import { isCustomBlockType } from '@/blocks/custom/build-config'
import { type BlockConfig, isHiddenFromDisplay, type SubBlockConfig } from '@/blocks/types'
import { getTrigger, isTriggerValid } from '@/triggers'
import { SYSTEM_SUBBLOCK_IDS } from '@/triggers/constants'

const logger = createLogger('CatalogBlockProjection')

/**
 * Surface-neutral projection of one block's full authoring shape: its
 * configuration fields, its per-operation inputs and outputs, its tools, and
 * its triggers.
 *
 * Extracted from the Copilot `get_blocks_metadata` tool so the public catalog
 * and the agent describe a block identically. Tool data comes from
 * `@/tools/metadata` + `@/tools/metadata-outputs`; reading `@/tools/registry`
 * for it is what used to make that tool's module graph 6,754 modules.
 */

/** A block-level input definition, as declared on `BlockConfig.inputs`. */
export interface CatalogInputDefinition {
  type: string
  description?: string
  /** JSON-Schema-shaped structure for object and array params. Arbitrarily nested. */
  schema?: unknown
}

/** A declared output of a block. */
export interface CatalogBlockOutput {
  type: string
  description?: string
}

/** One operation a block exposes, resolved to the tool that performs it. */
export interface CatalogBlockOperation {
  toolId?: string
  toolName?: string
  description?: string
  /** Tool params plus operation-scoped block inputs, minus anything the block supplies itself. */
  inputs: Record<string, CatalogInputDefinition | CatalogToolDetail['params'][string]>
  outputs: Record<string, CatalogToolOutput>
  /** The configuration fields that appear when this operation is selected. */
  inputSchema: CatalogSubBlock[]
}

/** One trigger a block can run on. */
export interface CatalogBlockTrigger {
  id: string
  outputs: Record<string, CatalogBlockOutput>
  configFields: Record<string, CatalogTriggerConfigField>
}

/**
 * Projects a trigger's declared outputs.
 *
 * `TriggerOutput` is an open, self-nesting shape whose extra keys are nested
 * outputs. Only the top level is published, with the same `type`/`description`
 * projection every other output family gets — a caller reads a trigger's real
 * payload from a run, not from a schema that cannot describe it faithfully.
 */
function projectTriggerOutputs(
  outputs: Record<string, { type?: string; description?: unknown }> | undefined
): Record<string, CatalogBlockOutput> {
  const projected: Record<string, CatalogBlockOutput> = {}
  for (const [key, definition] of Object.entries(outputs ?? {})) {
    if (!definition || typeof definition !== 'object') continue
    const entry: CatalogBlockOutput = { type: String(definition.type ?? 'any') }
    if (typeof definition.description === 'string') entry.description = definition.description
    projected[key] = entry
  }
  return projected
}

/** One configurable field of a trigger. */
export interface CatalogTriggerConfigField {
  type: string
  required: boolean
  title?: string
  description?: string
  placeholder?: string
  default?: unknown
  options?: { id: string; label: string }[]
  condition?: CatalogSubBlock['condition']
}

/** The full authoring shape of one block. */
export interface CatalogBlockDetail extends CatalogBlockSummary {
  bestPractices?: string
  /** Configuration fields that apply regardless of the selected operation. */
  inputSchema: CatalogSubBlock[]
  /** Configuration fields keyed by the operation that reveals them. */
  operationInputSchema: Record<string, CatalogSubBlock[]>
  /** Block-level input definitions, keyed by param name. */
  inputDefinitions: Record<string, CatalogInputDefinition>
  operations: Record<string, CatalogBlockOperation>
  tools: CatalogToolDetail[]
  triggers: CatalogBlockTrigger[]
  outputs: Record<string, CatalogBlockOutput>
}

/** Per-surface inputs to a block detail projection. */
export interface BlockDetailProjectionOptions {
  /** The deployment whose hosted-key availability the projected tools report. */
  deployment: CatalogDeployment
  /** How this surface renders a tool's description. Defaults to the tool's own text. */
  describeTool?: (tool: CatalogToolSummary) => string
}

/**
 * Param keys a block supplies itself rather than accepting from an author.
 *
 * `hideFromCopilot` marks server-only lifecycle configuration — a webhook's
 * stored secret, a poller's cursor — that no authoring surface should publish,
 * whether the author is an agent or a human writing against the API.
 */
export function hiddenParamKeys(block: BlockConfig): Set<string> {
  const hidden = new Set<string>()
  for (const subBlock of block.subBlocks ?? []) {
    if (!subBlock.hideFromCopilot) continue
    if (subBlock.id) hidden.add(subBlock.id)
    if (subBlock.canonicalParamId) hidden.add(subBlock.canonicalParamId)
  }
  return hidden
}

/**
 * Sub-blocks an authoring surface may configure, minus the hidden ones.
 *
 * Action fields for an ordinary block. A `triggers`-category block has no
 * action side — every field it declares is trigger-mode, and the serializer
 * keeps those — so its trigger fields are the authorable ones, minus the
 * system-managed display and lifecycle fields.
 */
function authorableSubBlocks(block: BlockConfig): SubBlockConfig[] {
  const fields =
    block.category === 'triggers'
      ? (block.subBlocks ?? []).filter((subBlock) => !SYSTEM_SUBBLOCK_IDS.includes(subBlock.id))
      : actionSubBlocks(block)
  return fields.filter((subBlock) => !subBlock.hideFromCopilot)
}

/** Whether a condition gates its field on a specific operation being selected. */
function operationGate(subBlock: SubBlockConfig): { values: string[] } | undefined {
  const condition = normalizeCondition(subBlock.condition)
  if (!condition || condition.field !== 'operation' || condition.not) return undefined
  if (condition.value === undefined) return undefined
  const values = Array.isArray(condition.value) ? condition.value : [condition.value]
  return { values: values.map((value) => String(value)) }
}

/**
 * Splits a block's fields into the ones that always apply and the ones each
 * operation reveals.
 *
 * A field gated on `operation` belongs to every operation it names, so a caller
 * reading one operation sees exactly the fields that operation needs. Ungated
 * fields take their description from the block's own input definitions when one
 * is declared, which is where the authored prose lives.
 */
export function splitFieldsByOperation(
  subBlocks: SubBlockConfig[],
  inputDefinitions: Record<string, CatalogInputDefinition> = {}
): {
  commonFields: CatalogSubBlock[]
  operationFields: Record<string, CatalogSubBlock[]>
} {
  const commonFields: CatalogSubBlock[] = []
  const operationFields: Record<string, CatalogSubBlock[]> = {}

  for (const subBlock of subBlocks) {
    const projected = projectSubBlock(subBlock)
    const gate = operationGate(subBlock)

    if (gate) {
      for (const operationId of gate.values) {
        operationFields[operationId] ??= []
        operationFields[operationId].push(projected)
      }
      continue
    }

    for (const key of [subBlock.id, subBlock.canonicalParamId]) {
      if (!key) continue
      const definition = inputDefinitions[key]
      if (definition && typeof definition.description === 'string') {
        projected.description = definition.description
        break
      }
    }
    commonFields.push(projected)
  }

  return { commonFields, operationFields }
}

/** Block-level inputs: those not scoped to a single operation and not block-supplied. */
export function computeBlockLevelInputs(
  block: BlockConfig,
  hidden = hiddenParamKeys(block)
): Record<string, CatalogInputDefinition> {
  const subBlocksByParamKey = new Map<string, SubBlockConfig[]>()
  for (const subBlock of authorableSubBlocks(block)) {
    for (const key of [subBlock.id, subBlock.canonicalParamId]) {
      if (!key) continue
      const bucket = subBlocksByParamKey.get(key)
      if (bucket) bucket.push(subBlock)
      else subBlocksByParamKey.set(key, [subBlock])
    }
  }

  const blockInputs: Record<string, CatalogInputDefinition> = {}
  for (const [key, definition] of Object.entries(block.inputs ?? {})) {
    if (hidden.has(key)) continue
    const gated = (subBlocksByParamKey.get(key) ?? []).some((subBlock) =>
      Boolean(operationGate(subBlock))
    )
    if (!gated) blockInputs[key] = definition
  }
  return blockInputs
}

/**
 * Input definitions scoped to one operation, keyed by operation id.
 *
 * Each input is published under the sub-block id — the field name an apply
 * accepts — even when the block declares its definition under the field's
 * `canonicalParamId`, which is the executor-side param and not a writable field.
 */
export function computeOperationLevelInputs(
  block: BlockConfig
): Record<string, Record<string, CatalogInputDefinition>> {
  const inputs = block.inputs ?? {}
  const operationInputs: Record<string, Record<string, CatalogInputDefinition>> = {}

  for (const subBlock of authorableSubBlocks(block)) {
    const gate = operationGate(subBlock)
    if (!gate) continue
    const definition =
      inputs[subBlock.id] ??
      (subBlock.canonicalParamId !== undefined ? inputs[subBlock.canonicalParamId] : undefined)
    if (!definition) continue
    for (const operationId of gate.values) {
      operationInputs[operationId] ??= {}
      operationInputs[operationId][subBlock.id] = definition
    }
  }

  return operationInputs
}

/**
 * The tool a block runs for one operation.
 *
 * The selector is an authored function invoked with only `{ operation }`, so a
 * selector that reads another param can throw. That is a block-authoring
 * problem rather than a caller's, so it degrades to "no tool resolved" and is
 * logged, exactly as it did before this projection was extracted.
 */
export function resolveToolIdForOperation(
  block: BlockConfig,
  operationId: string
): string | undefined {
  const selector = block.tools?.config?.tool
  if (typeof selector !== 'function') return undefined
  try {
    const toolId = selector({ operation: operationId })
    return typeof toolId === 'string' ? toolId : undefined
  } catch (error) {
    logger.warn('Failed to resolve tool ID for operation', {
      blockType: block.type,
      operationId,
      error: toError(error).message,
    })
    return undefined
  }
}

/** Projects a block's declared outputs, dropping the ones hidden from display. */
export function projectBlockOutputs(
  outputs: BlockConfig['outputs'] | undefined
): Record<string, CatalogBlockOutput> {
  const projected: Record<string, CatalogBlockOutput> = {}
  for (const [key, definition] of Object.entries(outputs ?? {})) {
    if (isHiddenFromDisplay(definition)) continue
    if (typeof definition === 'string') {
      projected[key] = { type: definition }
      continue
    }
    if (!definition || typeof definition !== 'object') continue
    const entry: CatalogBlockOutput = { type: String(definition.type ?? 'any') }
    if ('description' in definition && typeof definition.description === 'string') {
      entry.description = definition.description
    }
    projected[key] = entry
  }
  return projected
}

/**
 * Projects the triggers a block supports, with each trigger's configurable
 * fields.
 *
 * Only ids backed by a `TRIGGER_REGISTRY` entry are projected, because only
 * those declare outputs and config fields. The universal entry points name
 * theirs by kind instead — `start_trigger` declares `chat`, `manual` and `api`,
 * none of which is a registered trigger definition — so those blocks
 * legitimately publish an empty `triggers` array while `triggerCapable` and
 * `triggerIds` on the summary carry what they can actually start. That is a
 * routine registry shape rather than an authoring defect, so it logs at `debug`:
 * at `warn` the five core trigger blocks emitted seven warnings on every sweep.
 */
export function projectBlockTriggers(block: BlockConfig): CatalogBlockTrigger[] {
  const triggers: CatalogBlockTrigger[] = []
  for (const triggerId of block.triggers?.available ?? []) {
    if (!isTriggerValid(triggerId)) {
      logger.debug('Block names a trigger kind with no registered definition', {
        blockType: block.type,
        triggerId,
      })
      continue
    }
    const trigger = getTrigger(triggerId)
    const configFields: Record<string, CatalogTriggerConfigField> = {}

    for (const subBlock of trigger.subBlocks) {
      const isTriggerField = subBlock.mode === 'trigger' || subBlock.mode === 'trigger-advanced'
      if (!isTriggerField || SYSTEM_SUBBLOCK_IDS.includes(subBlock.id)) continue

      const field: CatalogTriggerConfigField = {
        type: subBlock.type,
        required: Boolean(subBlock.required),
      }
      if (subBlock.title) field.title = subBlock.title
      if (subBlock.description) field.description = subBlock.description
      if (subBlock.placeholder) field.placeholder = subBlock.placeholder
      if (subBlock.defaultValue !== undefined) field.default = subBlock.defaultValue
      if (Array.isArray(subBlock.options)) {
        field.options = subBlock.options.map((option) => ({
          id: option.id,
          label: option.label || option.id,
        }))
      }
      const condition = normalizeCondition(subBlock.condition)
      if (condition) field.condition = condition

      configFields[subBlock.id] = field
    }

    triggers.push({
      id: triggerId,
      outputs: projectTriggerOutputs(trigger.outputs),
      configFields,
    })
  }
  return triggers
}

/**
 * A custom (deploy-as-block) block's detail.
 *
 * A custom block runs a bound workflow through an internal executor, so it has
 * no operations and no author-visible tools — only its own input fields and the
 * outputs the bound workflow produces.
 */
function projectCustomBlockDetail(block: BlockConfig): CatalogBlockDetail {
  const visibleFields = (block.subBlocks ?? []).filter(
    (subBlock) => !subBlock.hidden && !subBlock.hideFromCopilot
  )
  return {
    ...projectBlockSummary(block),
    inputSchema: visibleFields.map(projectSubBlock),
    operationInputSchema: {},
    inputDefinitions: {},
    operations: {},
    tools: [],
    triggers: [],
    outputs: projectBlockOutputs(block.outputs),
    ...(block.bestPractices !== undefined ? { bestPractices: block.bestPractices } : {}),
  }
}

/** Projects one block config to its full catalog detail. */
export function projectBlockDetail(
  block: BlockConfig,
  options: BlockDetailProjectionOptions
): CatalogBlockDetail {
  if (isCustomBlockType(block.type)) return projectCustomBlockDetail(block)

  const describeTool = options.describeTool ?? ((tool: CatalogToolSummary) => tool.description)
  const hidden = hiddenParamKeys(block)
  const inputDefinitions = computeBlockLevelInputs(block, hidden)
  const { commonFields, operationFields } = splitFieldsByOperation(
    authorableSubBlocks(block),
    inputDefinitions
  )

  const tools: CatalogToolDetail[] = []
  for (const toolId of block.tools?.access ?? []) {
    const tool = projectToolDetail(toolId, options.deployment)
    tools.push(
      tool
        ? { ...tool, description: describeTool(tool) }
        : {
            id: toolId,
            name: toolId,
            description: '',
            hostedApiKey: 'none',
            params: {},
            outputs: {},
          }
    )
  }

  const operationInputs = computeOperationLevelInputs(block)
  const operations: Record<string, CatalogBlockOperation> = {}
  for (const operationId of resolveOperationIds(block)) {
    const toolId = resolveToolIdForOperation(block, operationId)
    const tool = toolId ? projectToolDetail(toolId, options.deployment) : undefined

    const inputs: CatalogBlockOperation['inputs'] = {}
    for (const [key, param] of Object.entries(tool?.params ?? {})) {
      if (key in inputDefinitions || hidden.has(key)) continue
      inputs[key] = param
    }
    Object.assign(inputs, operationInputs[operationId] ?? {})

    operations[operationId] = {
      inputs,
      outputs: tool?.outputs ?? {},
      inputSchema: operationFields[operationId] ?? [],
      ...(toolId !== undefined ? { toolId } : {}),
      ...(tool ? { toolName: tool.name, description: describeTool(tool) } : {}),
    }
  }

  return {
    ...projectBlockSummary(block),
    inputSchema: commonFields,
    operationInputSchema: operationFields,
    inputDefinitions,
    operations,
    tools,
    triggers: projectBlockTriggers(block),
    outputs: projectBlockOutputs(block.outputs),
    ...(block.bestPractices !== undefined ? { bestPractices: block.bestPractices } : {}),
  }
}
