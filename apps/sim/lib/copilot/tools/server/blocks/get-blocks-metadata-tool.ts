import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import {
  type GetBlocksMetadataInput,
  GetBlocksMetadataResult,
} from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'
import { registry as blockRegistry } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { tools as toolsRegistry } from '@/tools/registry'
import { TRIGGER_REGISTRY } from '@/triggers'

export interface CopilotSubblockMetadata {
  id: string
  type: string
  title?: string
  required?: boolean
  description?: string
  placeholder?: string
  layout?: string
  mode?: string
  hidden?: boolean
  condition?: any
  // Dropdown/combobox options
  options?: { id: string; label?: string; hasIcon?: boolean }[]
  // Numeric constraints
  min?: number
  max?: number
  step?: number
  integer?: boolean
  // Text input properties
  rows?: number
  password?: boolean
  multiSelect?: boolean
  // Code/generation properties
  language?: string
  generationType?: string
  // OAuth/credential properties
  provider?: string
  serviceId?: string
  requiredScopes?: string[]
  // File properties
  mimeType?: string
  acceptedTypes?: string
  multiple?: boolean
  maxSize?: number
  // Other properties
  connectionDroppable?: boolean
  columns?: string[]
  wandConfig?: any
  availableTriggers?: string[]
  triggerProvider?: string
  dependsOn?: string[]
  canonicalParamId?: string
  defaultValue?: any
  value?: string // 'function' if it's a function, undefined otherwise
}

export interface CopilotToolMetadata {
  id: string
  name: string
  description?: string
  inputs?: any
  outputs?: any
}

export interface CopilotTriggerMetadata {
  id: string
  outputs?: any
  configFields?: any
}

export interface CopilotBlockMetadata {
  id: string
  name: string
  description: string
  bestPractices?: string
  inputSchema: CopilotSubblockMetadata[]
  inputDefinitions?: Record<string, any>
  triggerAllowed?: boolean
  authType?: 'OAuth' | 'API Key' | 'Bot Token'
  tools: CopilotToolMetadata[]
  triggers: CopilotTriggerMetadata[]
  operationInputSchema: Record<string, CopilotSubblockMetadata[]>
  operations?: Record<
    string,
    {
      toolId?: string
      toolName?: string
      description?: string
      inputs?: Record<string, any>
      outputs?: Record<string, any>
      inputSchema?: CopilotSubblockMetadata[]
    }
  >
  yamlDocumentation?: string
}

export const getBlocksMetadataServerTool: BaseServerTool<
  ReturnType<typeof GetBlocksMetadataInput.parse>,
  ReturnType<typeof GetBlocksMetadataResult.parse>
> = {
  name: 'get_blocks_metadata',
  async execute({
    blockIds,
  }: ReturnType<typeof GetBlocksMetadataInput.parse>): Promise<
    ReturnType<typeof GetBlocksMetadataResult.parse>
  > {
    const logger = createLogger('GetBlocksMetadataServerTool')
    logger.debug('Executing get_blocks_metadata', { count: blockIds?.length })

    const result: Record<string, CopilotBlockMetadata> = {}
    for (const blockId of blockIds || []) {
      let metadata: any

      if (SPECIAL_BLOCKS_METADATA[blockId]) {
        const specialBlock = SPECIAL_BLOCKS_METADATA[blockId]
        const { commonParameters, operationParameters } = splitParametersByOperation(
          specialBlock.subBlocks || [],
          specialBlock.inputs || {}
        )
        metadata = {
          id: specialBlock.id,
          name: specialBlock.name,
          description: specialBlock.description || '',
          inputSchema: commonParameters,
          inputDefinitions: specialBlock.inputs || {},
          tools: [],
          triggers: [],
          operationInputSchema: operationParameters,
        }
        ;(metadata as any).subBlocks = undefined
      } else {
        const blockConfig: BlockConfig | undefined = blockRegistry[blockId]
        if (!blockConfig) {
          logger.debug('Block not found in registry', { blockId })
          continue
        }

        if (blockConfig.hideFromToolbar) {
          logger.debug('Skipping block hidden from toolbar', { blockId })
          continue
        }
        const tools: CopilotToolMetadata[] = Array.isArray(blockConfig.tools?.access)
          ? blockConfig.tools!.access.map((toolId) => {
              const tool = toolsRegistry[toolId]
              if (!tool) return { id: toolId, name: toolId }
              return {
                id: toolId,
                name: tool.name || toolId,
                description: tool.description || '',
                inputs: tool.params || {},
                outputs: tool.outputs || {},
              }
            })
          : []

        const triggers: CopilotTriggerMetadata[] = []
        const availableTriggerIds = blockConfig.triggers?.available || []
        for (const tid of availableTriggerIds) {
          const trig = TRIGGER_REGISTRY[tid]
          triggers.push({
            id: tid,
            outputs: trig?.outputs || {},
            configFields: trig?.configFields || {},
          })
        }

        const blockInputs = computeBlockLevelInputs(blockConfig)
        const { commonParameters, operationParameters } = splitParametersByOperation(
          Array.isArray(blockConfig.subBlocks) ? blockConfig.subBlocks : [],
          blockInputs
        )

        const operationInputs = computeOperationLevelInputs(blockConfig)
        const operationIds = resolveOperationIds(blockConfig, operationParameters)
        const operations: Record<string, any> = {}
        for (const opId of operationIds) {
          const resolvedToolId = resolveToolIdForOperation(blockConfig, opId)
          const toolCfg = resolvedToolId ? toolsRegistry[resolvedToolId] : undefined
          const toolParams: Record<string, any> = toolCfg?.params || {}
          const toolOutputs: Record<string, any> = toolCfg?.outputs || {}
          const filteredToolParams: Record<string, any> = {}
          for (const [k, v] of Object.entries(toolParams)) {
            if (!(k in blockInputs)) filteredToolParams[k] = v
          }
          operations[opId] = {
            toolId: resolvedToolId,
            toolName: toolCfg?.name || resolvedToolId,
            description: toolCfg?.description || undefined,
            inputs: { ...filteredToolParams, ...(operationInputs[opId] || {}) },
            outputs: toolOutputs,
            inputSchema: operationParameters[opId] || [],
          }
        }

        metadata = {
          id: blockId,
          name: blockConfig.name || blockId,
          description: blockConfig.longDescription || blockConfig.description || '',
          bestPractices: blockConfig.bestPractices,
          inputSchema: commonParameters,
          inputDefinitions: blockInputs,
          triggerAllowed: !!blockConfig.triggerAllowed,
          authType: resolveAuthType(blockConfig.authMode),
          tools,
          triggers,
          operationInputSchema: operationParameters,
          operations,
        }
      }

      try {
        const workingDir = process.cwd()
        const isInAppsSim = workingDir.endsWith('/apps/sim') || workingDir.endsWith('\\apps\\sim')
        const basePath = isInAppsSim ? join(workingDir, '..', '..') : workingDir
        const docPath = join(
          basePath,
          'apps',
          'docs',
          'content',
          'docs',
          'yaml',
          'blocks',
          `${DOCS_FILE_MAPPING[blockId] || blockId}.mdx`
        )
        if (existsSync(docPath)) {
          metadata.yamlDocumentation = readFileSync(docPath, 'utf-8')
        }
      } catch {}

      if (metadata) {
        result[blockId] = removeNullish(metadata) as CopilotBlockMetadata
      }
    }

    return GetBlocksMetadataResult.parse({ metadata: result })
  },
}

function processSubBlock(sb: any): CopilotSubblockMetadata {
  // Start with required fields
  const processed: CopilotSubblockMetadata = {
    id: sb.id,
    type: sb.type,
  }

  // Process all optional fields - only add if they exist and are not null/undefined
  const optionalFields = {
    // Basic properties
    title: sb.title,
    required: sb.required,
    description: sb.description,
    placeholder: sb.placeholder,
    layout: sb.layout,
    mode: sb.mode,
    hidden: sb.hidden,
    canonicalParamId: sb.canonicalParamId,
    defaultValue: sb.defaultValue,

    // Numeric constraints
    min: sb.min,
    max: sb.max,
    step: sb.step,
    integer: sb.integer,

    // Text input properties
    rows: sb.rows,
    password: sb.password,
    multiSelect: sb.multiSelect,

    // Code/generation properties
    language: sb.language,
    generationType: sb.generationType,

    // OAuth/credential properties
    provider: sb.provider,
    serviceId: sb.serviceId,
    requiredScopes: sb.requiredScopes,

    // File properties
    mimeType: sb.mimeType,
    acceptedTypes: sb.acceptedTypes,
    multiple: sb.multiple,
    maxSize: sb.maxSize,

    // Other properties
    connectionDroppable: sb.connectionDroppable,
    columns: sb.columns,
    wandConfig: sb.wandConfig,
    availableTriggers: sb.availableTriggers,
    triggerProvider: sb.triggerProvider,
    dependsOn: sb.dependsOn,
  }

  // Add non-null optional fields
  for (const [key, value] of Object.entries(optionalFields)) {
    if (value !== undefined && value !== null) {
      ;(processed as any)[key] = value
    }
  }

  // Handle condition normalization
  const condition = normalizeCondition(sb.condition)
  if (condition !== undefined) {
    processed.condition = condition
  }

  // Handle value field (check if it's a function)
  if (typeof sb.value === 'function') {
    processed.value = 'function'
  }

  // Process options with icon detection
  const options = resolveSubblockOptions(sb)
  if (options) {
    processed.options = options
  }

  return processed
}

function resolveAuthType(
  authMode: AuthMode | undefined
): 'OAuth' | 'API Key' | 'Bot Token' | undefined {
  if (!authMode) return undefined
  if (authMode === AuthMode.OAuth) return 'OAuth'
  if (authMode === AuthMode.ApiKey) return 'API Key'
  if (authMode === AuthMode.BotToken) return 'Bot Token'
  return undefined
}

function resolveSubblockOptions(
  sb: any
): { id: string; label?: string; hasIcon?: boolean }[] | undefined {
  try {
    // Resolve options if it's a function
    const rawOptions = typeof sb.options === 'function' ? sb.options() : sb.options
    if (!Array.isArray(rawOptions)) return undefined

    const normalized = rawOptions
      .map((opt: any) => {
        if (!opt) return undefined

        // Handle both string and object options
        const id = typeof opt === 'object' ? opt.id : opt
        if (id === undefined || id === null) return undefined

        const result: { id: string; label?: string; hasIcon?: boolean } = {
          id: String(id),
        }

        // Add label if present
        if (typeof opt === 'object' && typeof opt.label === 'string') {
          result.label = opt.label
        }

        // Check for icon presence
        if (typeof opt === 'object' && opt.icon) {
          result.hasIcon = true
        }

        return result
      })
      .filter((o): o is { id: string; label?: string; hasIcon?: boolean } => o !== undefined)

    return normalized.length > 0 ? normalized : undefined
  } catch {
    return undefined
  }
}

function removeNullish(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj

  const cleaned: any = Array.isArray(obj) ? [] : {}

  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined) {
      cleaned[key] = value
    }
  }

  return cleaned
}

function normalizeCondition(condition: any): any | undefined {
  try {
    if (!condition) return undefined
    if (typeof condition === 'function') {
      return condition()
    }
    return condition
  } catch {
    return undefined
  }
}

function splitParametersByOperation(
  subBlocks: any[],
  blockInputsForDescriptions?: Record<string, any>
): {
  commonParameters: CopilotSubblockMetadata[]
  operationParameters: Record<string, CopilotSubblockMetadata[]>
} {
  const commonParameters: CopilotSubblockMetadata[] = []
  const operationParameters: Record<string, CopilotSubblockMetadata[]> = {}

  for (const sb of subBlocks || []) {
    const cond = normalizeCondition(sb.condition)
    const processed = processSubBlock(sb)

    if (cond && cond.field === 'operation' && !cond.not && cond.value !== undefined) {
      const values: any[] = Array.isArray(cond.value) ? cond.value : [cond.value]
      for (const v of values) {
        const key = String(v)
        if (!operationParameters[key]) operationParameters[key] = []
        operationParameters[key].push(processed)
      }
    } else {
      // Override description from inputDefinitions if available (by id or canonicalParamId)
      if (blockInputsForDescriptions) {
        const candidates = [sb.id, sb.canonicalParamId].filter(Boolean)
        for (const key of candidates) {
          const bi = (blockInputsForDescriptions as any)[key as string]
          if (bi && typeof bi.description === 'string') {
            processed.description = bi.description
            break
          }
        }
      }
      commonParameters.push(processed)
    }
  }

  return { commonParameters, operationParameters }
}

function computeBlockLevelInputs(blockConfig: BlockConfig): Record<string, any> {
  const inputs = blockConfig.inputs || {}
  const subBlocks: any[] = Array.isArray(blockConfig.subBlocks) ? blockConfig.subBlocks : []

  // Build quick lookup of subBlocks by id and canonicalParamId
  const byParamKey: Record<string, any[]> = {}
  for (const sb of subBlocks) {
    if (sb.id) {
      byParamKey[sb.id] = byParamKey[sb.id] || []
      byParamKey[sb.id].push(sb)
    }
    if (sb.canonicalParamId) {
      byParamKey[sb.canonicalParamId] = byParamKey[sb.canonicalParamId] || []
      byParamKey[sb.canonicalParamId].push(sb)
    }
  }

  const blockInputs: Record<string, any> = {}
  for (const key of Object.keys(inputs)) {
    const sbs = byParamKey[key] || []
    // If any related subBlock is gated by operation, treat as operation-level and exclude
    const isOperationGated = sbs.some((sb) => {
      const cond = normalizeCondition(sb.condition)
      return cond && cond.field === 'operation' && !cond.not && cond.value !== undefined
    })
    if (!isOperationGated) {
      blockInputs[key] = inputs[key]
    }
  }

  return blockInputs
}

function computeOperationLevelInputs(
  blockConfig: BlockConfig
): Record<string, Record<string, any>> {
  const inputs = blockConfig.inputs || {}
  const subBlocks = Array.isArray(blockConfig.subBlocks) ? blockConfig.subBlocks : []

  const opInputs: Record<string, Record<string, any>> = {}

  // Map subblocks to inputs keys via id or canonicalParamId and collect by operation
  for (const sb of subBlocks) {
    const cond = normalizeCondition(sb.condition)
    if (!cond || cond.field !== 'operation' || cond.not) continue
    const keys: string[] = []
    if (sb.canonicalParamId) keys.push(sb.canonicalParamId)
    if (sb.id) keys.push(sb.id)
    const values = Array.isArray(cond.value) ? cond.value : [cond.value]
    for (const key of keys) {
      if (!(key in inputs)) continue
      for (const v of values) {
        const op = String(v)
        if (!opInputs[op]) opInputs[op] = {}
        opInputs[op][key] = inputs[key]
      }
    }
  }

  return opInputs
}

function resolveOperationIds(
  blockConfig: BlockConfig,
  operationParameters: Record<string, CopilotSubblockMetadata[]>
): string[] {
  // Prefer explicit operation subblock options if present
  const opBlock = (blockConfig.subBlocks || []).find((sb) => sb.id === 'operation')
  if (opBlock && Array.isArray(opBlock.options)) {
    const ids = opBlock.options.map((o) => o.id).filter(Boolean)
    if (ids.length > 0) return ids
  }
  // Fallback: keys from operationParameters
  return Object.keys(operationParameters)
}

function resolveToolIdForOperation(blockConfig: BlockConfig, opId: string): string | undefined {
  try {
    const toolSelector = blockConfig.tools?.config?.tool
    if (typeof toolSelector === 'function') {
      const maybeToolId = toolSelector({ operation: opId })
      if (typeof maybeToolId === 'string') return maybeToolId
    }
  } catch {}
  return undefined
}

const DOCS_FILE_MAPPING: Record<string, string> = {}

const SPECIAL_BLOCKS_METADATA: Record<string, any> = {
  loop: {
    id: 'loop',
    name: 'Loop',
    description: 'Control flow block for iterating over collections or repeating actions',
    longDescription:
      'Control flow block for iterating over collections or repeating actions serially',
    bestPractices: `
    - Set reasonable limits for iterations.
    - Use forEach for collection processing, for loops for fixed iterations.
    - Cannot have loops/parallels inside a loop block.
    - For yaml it needs to connect blocks inside to the start field of the block.
    `,
    inputs: {
      loopType: { type: 'string', required: true, enum: ['for', 'forEach'] },
      iterations: { type: 'number', required: false, minimum: 1, maximum: 1000 },
      collection: { type: 'string', required: false },
      maxConcurrency: { type: 'number', required: false, default: 1, minimum: 1, maximum: 10 },
    },
    outputs: {
      results: 'array',
      currentIndex: 'number',
      currentItem: 'any',
      totalIterations: 'number',
    },
    subBlocks: [
      {
        id: 'loopType',
        title: 'Loop Type',
        type: 'dropdown',
        required: true,
        options: [
          { label: 'For Loop (count)', id: 'for' },
          { label: 'For Each (collection)', id: 'forEach' },
        ],
      },
      {
        id: 'iterations',
        title: 'Iterations',
        type: 'slider',
        min: 1,
        max: 1000,
        integer: true,
        condition: { field: 'loopType', value: 'for' },
      },
      {
        id: 'collection',
        title: 'Collection',
        type: 'short-input',
        placeholder: 'Array or object to iterate over...',
        condition: { field: 'loopType', value: 'forEach' },
      },
      {
        id: 'maxConcurrency',
        title: 'Max Concurrency',
        type: 'slider',
        min: 1,
        max: 10,
        integer: true,
        default: 1,
      },
    ],
  },
  parallel: {
    id: 'parallel',
    name: 'Parallel',
    description: 'Control flow block for executing multiple branches simultaneously',
    longDescription: 'Control flow block for executing multiple branches simultaneously',
    bestPractices: `
    - Keep structures inside simple. Cannot have multiple blocks within a parallel block.
    - Cannot have loops/parallels inside a parallel block.
    - Agent block combobox can be <parallel.currentItem> if the user wants to query multiple models in parallel. The collection has to be an array of correct model strings available for the agent block.
    - For yaml it needs to connect blocks inside to the start field of the block.
    `,
    inputs: {
      parallelType: { type: 'string', required: true, enum: ['count', 'collection'] },
      count: { type: 'number', required: false, minimum: 1, maximum: 100 },
      collection: { type: 'string', required: false },
      maxConcurrency: { type: 'number', required: false, default: 10, minimum: 1, maximum: 50 },
    },
    outputs: { results: 'array', branchId: 'number', branchItem: 'any', totalBranches: 'number' },
    subBlocks: [
      {
        id: 'parallelType',
        title: 'Parallel Type',
        type: 'dropdown',
        required: true,
        options: [
          { label: 'Count (number)', id: 'count' },
          { label: 'Collection (array)', id: 'collection' },
        ],
      },
      {
        id: 'count',
        title: 'Count',
        type: 'slider',
        min: 1,
        max: 100,
        integer: true,
        condition: { field: 'parallelType', value: 'count' },
      },
      {
        id: 'collection',
        title: 'Collection',
        type: 'short-input',
        placeholder: 'Array to process in parallel...',
        condition: { field: 'parallelType', value: 'collection' },
      },
      {
        id: 'maxConcurrency',
        title: 'Max Concurrency',
        type: 'slider',
        min: 1,
        max: 50,
        integer: true,
        default: 10,
      },
    ],
  },
}
