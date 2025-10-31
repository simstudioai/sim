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
import { getTrigger, isTriggerValid } from '@/triggers'
import { SYSTEM_SUBBLOCK_IDS } from '@/triggers/consts'

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
  outputs?: Record<string, any>
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
          outputs: specialBlock.outputs,
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
          if (!isTriggerValid(tid)) {
            logger.debug('Invalid trigger ID found in block config', { blockId, triggerId: tid })
            continue
          }

          const trig = getTrigger(tid)

          const configFields: Record<string, any> = {}
          for (const subBlock of trig.subBlocks) {
            if (subBlock.mode === 'trigger' && !SYSTEM_SUBBLOCK_IDS.includes(subBlock.id)) {
              const fieldDef: any = {
                type: subBlock.type,
                required: subBlock.required || false,
              }

              if (subBlock.title) fieldDef.title = subBlock.title
              if (subBlock.description) fieldDef.description = subBlock.description
              if (subBlock.placeholder) fieldDef.placeholder = subBlock.placeholder
              if (subBlock.defaultValue !== undefined) fieldDef.default = subBlock.defaultValue

              if (subBlock.options && Array.isArray(subBlock.options)) {
                fieldDef.options = subBlock.options.map((opt: any) => ({
                  id: opt.id,
                  label: opt.label || opt.id,
                }))
              }

              if (subBlock.condition) {
                const cond =
                  typeof subBlock.condition === 'function'
                    ? subBlock.condition()
                    : subBlock.condition
                if (cond) {
                  fieldDef.condition = cond
                }
              }

              configFields[subBlock.id] = fieldDef
            }
          }

          triggers.push({
            id: tid,
            outputs: trig.outputs || {},
            configFields,
          })
        }

        const blockInputs = computeBlockLevelInputs(blockConfig)
        const { commonParameters, operationParameters } = splitParametersByOperation(
          Array.isArray(blockConfig.subBlocks)
            ? blockConfig.subBlocks.filter((sb) => sb.mode !== 'trigger')
            : [],
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
          outputs: blockConfig.outputs,
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

    const transformedResult: Record<string, any> = {}
    for (const [blockId, metadata] of Object.entries(result)) {
      transformedResult[blockId] = transformBlockMetadata(metadata)
    }

    return GetBlocksMetadataResult.parse({ metadata: transformedResult })
  },
}

function transformBlockMetadata(metadata: CopilotBlockMetadata): any {
  const transformed: any = {
    blockType: metadata.id,
    name: metadata.name,
    description: metadata.description,
  }

  if (metadata.bestPractices) {
    transformed.bestPractices = metadata.bestPractices
  }

  if (metadata.authType) {
    transformed.authType = metadata.authType

    if (metadata.authType === 'OAuth') {
      transformed.requiredCredentials = {
        type: 'oauth',
        service: metadata.id, // e.g., 'gmail', 'slack', etc.
        description: `OAuth authentication required for ${metadata.name}`,
      }
    } else if (metadata.authType === 'API Key') {
      transformed.requiredCredentials = {
        type: 'api_key',
        description: `API key required for ${metadata.name}`,
      }
    } else if (metadata.authType === 'Bot Token') {
      transformed.requiredCredentials = {
        type: 'bot_token',
        description: `Bot token required for ${metadata.name}`,
      }
    }
  }

  const inputs = extractInputs(metadata)
  if (inputs.required.length > 0 || inputs.optional.length > 0) {
    transformed.inputs = inputs
  }

  const hasOperations = metadata.operations && Object.keys(metadata.operations).length > 0
  if (hasOperations && metadata.operations) {
    const blockLevelInputs = new Set(Object.keys(metadata.inputDefinitions || {}))
    transformed.operations = Object.entries(metadata.operations).reduce(
      (acc, [opId, opData]) => {
        acc[opId] = {
          name: opData.toolName || opId,
          description: opData.description,
          inputs: extractOperationInputs(opData, blockLevelInputs),
          outputs: formatOutputsFromDefinition(opData.outputs || {}),
        }
        return acc
      },
      {} as Record<string, any>
    )
  }

  if (!hasOperations) {
    const outputs = extractOutputs(metadata)
    if (outputs.length > 0) {
      transformed.outputs = outputs
    }
  }

  if (metadata.triggers && metadata.triggers.length > 0) {
    transformed.triggers = metadata.triggers.map((t) => ({
      id: t.id,
      outputs: formatOutputsFromDefinition(t.outputs || {}),
      configFields: t.configFields || {},
    }))
  }

  if (metadata.yamlDocumentation) {
    transformed.yamlDocumentation = metadata.yamlDocumentation
  }

  return transformed
}

function extractInputs(metadata: CopilotBlockMetadata): {
  required: any[]
  optional: any[]
} {
  const required: any[] = []
  const optional: any[] = []
  const inputDefs = metadata.inputDefinitions || {}

  for (const schema of metadata.inputSchema || []) {
    // Skip trigger subBlocks - they're handled separately in triggers.configFields
    if (schema.mode === 'trigger') {
      continue
    }

    if (
      schema.type === 'oauth-credential' ||
      schema.type === 'credential-input' ||
      schema.type === 'oauth-input'
    ) {
      continue
    }

    if (schema.id === 'triggerConfig' || schema.type === 'trigger-config') {
      continue
    }

    const inputDef = inputDefs[schema.id] || inputDefs[schema.canonicalParamId || '']

    let description = schema.description || inputDef?.description || schema.title
    if (schema.id === 'operation') {
      description = 'Operation to perform'
    }

    const input: any = {
      name: schema.id,
      type: mapSchemaTypeToSimpleType(schema.type, schema),
      description,
    }

    if (schema.options && schema.options.length > 0) {
      if (schema.id === 'operation') {
        input.options = schema.options.map((opt) => opt.id)
      } else {
        input.options = schema.options.map((opt) => opt.label || opt.id)
      }
    }

    if (inputDef?.enum && Array.isArray(inputDef.enum)) {
      input.options = inputDef.enum
    }

    if (schema.defaultValue !== undefined) {
      input.default = schema.defaultValue
    } else if (inputDef?.default !== undefined) {
      input.default = inputDef.default
    }

    if (schema.type === 'slider' || schema.type === 'number-input') {
      if (schema.min !== undefined) input.min = schema.min
      if (schema.max !== undefined) input.max = schema.max
    } else if (inputDef?.minimum !== undefined || inputDef?.maximum !== undefined) {
      if (inputDef.minimum !== undefined) input.min = inputDef.minimum
      if (inputDef.maximum !== undefined) input.max = inputDef.maximum
    }

    const example = generateInputExample(schema, inputDef)
    if (example !== undefined) {
      input.example = example
    }

    const isOperationField =
      schema.id === 'operation' &&
      metadata.operations &&
      Object.keys(metadata.operations).length > 0
    const isRequired = schema.required || inputDef?.required || isOperationField

    if (isRequired) {
      required.push(input)
    } else {
      optional.push(input)
    }
  }

  return { required, optional }
}

function extractOperationInputs(
  opData: any,
  blockLevelInputs: Set<string>
): {
  required: any[]
  optional: any[]
} {
  const required: any[] = []
  const optional: any[] = []
  const inputs = opData.inputs || {}

  for (const [key, inputDef] of Object.entries(inputs)) {
    if (blockLevelInputs.has(key)) {
      continue
    }

    const lowerKey = key.toLowerCase()
    if (
      lowerKey.includes('token') ||
      lowerKey.includes('credential') ||
      lowerKey.includes('apikey')
    ) {
      continue
    }

    const input: any = {
      name: key,
      type: (inputDef as any)?.type || 'string',
      description: (inputDef as any)?.description,
    }

    if ((inputDef as any)?.enum) {
      input.options = (inputDef as any).enum
    }

    if ((inputDef as any)?.default !== undefined) {
      input.default = (inputDef as any).default
    }

    if ((inputDef as any)?.example !== undefined) {
      input.example = (inputDef as any).example
    }

    if ((inputDef as any)?.required) {
      required.push(input)
    } else {
      optional.push(input)
    }
  }

  return { required, optional }
}

function extractOutputs(metadata: CopilotBlockMetadata): any[] {
  const outputs: any[] = []

  if (metadata.outputs && Object.keys(metadata.outputs).length > 0) {
    return formatOutputsFromDefinition(metadata.outputs)
  }

  if (metadata.operations && Object.keys(metadata.operations).length > 0) {
    const firstOp = Object.values(metadata.operations)[0]
    return formatOutputsFromDefinition(firstOp.outputs || {})
  }

  return outputs
}

function formatOutputsFromDefinition(outputDefs: Record<string, any>): any[] {
  const outputs: any[] = []

  for (const [key, def] of Object.entries(outputDefs)) {
    const output: any = {
      name: key,
      type: typeof def === 'string' ? def : def?.type || 'any',
    }

    if (typeof def === 'object') {
      if (def.description) output.description = def.description
      if (def.example) output.example = def.example
    }

    outputs.push(output)
  }

  return outputs
}

function mapSchemaTypeToSimpleType(schemaType: string, schema: CopilotSubblockMetadata): string {
  const typeMap: Record<string, string> = {
    'short-input': 'string',
    'long-input': 'string',
    'code-input': 'string',
    'number-input': 'number',
    slider: 'number',
    dropdown: 'string',
    combobox: 'string',
    toggle: 'boolean',
    'json-input': 'json',
    'file-upload': 'file',
    'multi-select': 'array',
    'credential-input': 'credential',
    'oauth-credential': 'credential',
  }

  const mappedType = typeMap[schemaType] || schemaType

  if (schema.multiSelect) return 'array'

  return mappedType
}

function generateInputExample(schema: CopilotSubblockMetadata, inputDef?: any): any {
  if (inputDef?.example !== undefined) return inputDef.example

  switch (schema.type) {
    case 'short-input':
    case 'long-input':
      if (schema.id === 'systemPrompt') return 'You are a helpful assistant...'
      if (schema.id === 'userPrompt') return 'What is the weather today?'
      if (schema.placeholder) return schema.placeholder
      return undefined
    case 'number-input':
    case 'slider':
      return schema.defaultValue ?? schema.min ?? 0
    case 'toggle':
      return schema.defaultValue ?? false
    case 'json-input':
      return schema.defaultValue ?? {}
    case 'dropdown':
    case 'combobox':
      if (schema.options && schema.options.length > 0) {
        return schema.options[0].id
      }
      return undefined
    default:
      return undefined
  }
}

function processSubBlock(sb: any): CopilotSubblockMetadata {
  const processed: CopilotSubblockMetadata = {
    id: sb.id,
    type: sb.type,
  }

  const optionalFields = {
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
    const rawOptions = typeof sb.options === 'function' ? sb.options() : sb.options
    if (!Array.isArray(rawOptions)) return undefined

    const normalized = rawOptions
      .map((opt: any) => {
        if (!opt) return undefined

        const id = typeof opt === 'object' ? opt.id : opt
        if (id === undefined || id === null) return undefined

        const result: { id: string; label?: string; hasIcon?: boolean } = {
          id: String(id),
        }

        if (typeof opt === 'object' && typeof opt.label === 'string') {
          result.label = opt.label
        }

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
  const subBlocks: any[] = Array.isArray(blockConfig.subBlocks)
    ? blockConfig.subBlocks.filter((sb) => sb.mode !== 'trigger')
    : []

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
  const subBlocks = Array.isArray(blockConfig.subBlocks)
    ? blockConfig.subBlocks.filter((sb) => sb.mode !== 'trigger')
    : []

  const opInputs: Record<string, Record<string, any>> = {}

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
  const opBlock = (blockConfig.subBlocks || []).find((sb) => sb.id === 'operation')
  if (opBlock && Array.isArray(opBlock.options)) {
    const ids = opBlock.options.map((o) => o.id).filter(Boolean)
    if (ids.length > 0) return ids
  }
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
      loopType: {
        type: 'string',
        required: true,
        enum: ['for', 'forEach', 'while', 'doWhile'],
        description:
          "Loop Type - 'for' runs N times, 'forEach' iterates over collection, 'while' runs while condition is true, 'doWhile' runs at least once then checks condition",
      },
      iterations: {
        type: 'number',
        required: false,
        minimum: 1,
        maximum: 1000,
        description: "Number of iterations (for 'for' loopType)",
        example: 5,
      },
      collection: {
        type: 'string',
        required: false,
        description: "Collection to iterate over (for 'forEach' loopType)",
        example: '<previousblock.items>',
      },
      condition: {
        type: 'string',
        required: false,
        description: "Condition to evaluate (for 'while' and 'doWhile' loopType)",
        example: '<loop.currentIteration> < 10',
      },
      maxConcurrency: {
        type: 'number',
        required: false,
        default: 1,
        minimum: 1,
        maximum: 10,
        description: 'Max parallel executions (1 = sequential)',
        example: 1,
      },
    },
    outputs: {
      results: { type: 'array', description: 'Array of results from each iteration' },
      currentIndex: { type: 'number', description: 'Current iteration index (0-based)' },
      currentItem: { type: 'any', description: 'Current item being iterated (for forEach loops)' },
      totalIterations: { type: 'number', description: 'Total number of iterations' },
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
          { label: 'While (condition)', id: 'while' },
          { label: 'Do While (condition)', id: 'doWhile' },
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
        id: 'condition',
        title: 'Condition',
        type: 'code',
        language: 'javascript',
        placeholder: '<counter.value> < 10',
        condition: { field: 'loopType', value: ['while', 'doWhile'] },
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
      parallelType: {
        type: 'string',
        required: true,
        enum: ['count', 'collection'],
        description: "Parallel Type - 'count' runs N branches, 'collection' runs one per item",
      },
      count: {
        type: 'number',
        required: false,
        minimum: 1,
        maximum: 100,
        description: "Number of parallel branches (for 'count' type)",
        example: 3,
      },
      collection: {
        type: 'string',
        required: false,
        description: "Collection to process in parallel (for 'collection' type)",
        example: '<previousblock.items>',
      },
      maxConcurrency: {
        type: 'number',
        required: false,
        default: 10,
        minimum: 1,
        maximum: 50,
        description: 'Max concurrent executions at once',
        example: 10,
      },
    },
    outputs: {
      results: { type: 'array', description: 'Array of results from all parallel branches' },
      branchId: { type: 'number', description: 'Current branch ID (0-based)' },
      branchItem: {
        type: 'any',
        description: 'Current item for this branch (for collection type)',
      },
      totalBranches: { type: 'number', description: 'Total number of parallel branches' },
    },
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
