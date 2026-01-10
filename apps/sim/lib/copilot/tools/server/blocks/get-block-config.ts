import { createLogger } from '@sim/logger'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import {
  type GetBlockConfigInputType,
  GetBlockConfigResult,
  type GetBlockConfigResultType,
} from '@/lib/copilot/tools/shared/schemas'
import { registry as blockRegistry } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'
import { getUserPermissionConfig } from '@/executor/utils/permission-check'
import { PROVIDER_DEFINITIONS } from '@/providers/models'
import { tools as toolsRegistry } from '@/tools/registry'

interface InputFieldSchema {
  type: string
  description?: string
  placeholder?: string
  required?: boolean
  options?: string[]
  default?: any
  min?: number
  max?: number
}

/**
 * Gets all available models from PROVIDER_DEFINITIONS as static options.
 * This provides fallback data when store state is not available server-side.
 */
function getStaticModelOptions(): string[] {
  const models: string[] = []

  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    // Skip providers with dynamic/fetched models
    if (provider.id === 'ollama' || provider.id === 'vllm' || provider.id === 'openrouter') {
      continue
    }
    if (provider?.models) {
      for (const model of provider.models) {
        models.push(model.id)
      }
    }
  }

  return models
}

/**
 * Attempts to call a dynamic options function with fallback data injected.
 */
function callOptionsWithFallback(optionsFn: () => any[]): any[] | undefined {
  const staticModels = getStaticModelOptions()

  const mockProvidersState = {
    providers: {
      base: { models: staticModels },
      ollama: { models: [] },
      vllm: { models: [] },
      openrouter: { models: [] },
    },
  }

  let originalGetState: (() => any) | undefined
  let store: any

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    store = require('@/stores/providers')
    if (store?.useProvidersStore?.getState) {
      originalGetState = store.useProvidersStore.getState
      store.useProvidersStore.getState = () => mockProvidersState
    }
  } catch {
    // Store module not available
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
 * Resolves options from a subBlock, handling both static arrays and dynamic functions
 */
function resolveSubBlockOptions(sb: SubBlockConfig): string[] | undefined {
  // Skip if subblock uses fetchOptions (async network calls)
  if (sb.fetchOptions) {
    return undefined
  }

  let rawOptions: any[] | undefined

  try {
    if (typeof sb.options === 'function') {
      rawOptions = callOptionsWithFallback(sb.options)
    } else {
      rawOptions = sb.options
    }
  } catch {
    return undefined
  }

  if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
    return undefined
  }

  return rawOptions
    .map((opt: any) => {
      if (!opt) return undefined
      if (typeof opt === 'object') {
        return opt.label || opt.id
      }
      return String(opt)
    })
    .filter((o): o is string => o !== undefined)
}

interface OutputFieldSchema {
  type: string
  description?: string
}

/**
 * Resolves the condition to check if it matches the given operation
 */
function matchesOperation(condition: any, operation: string): boolean {
  if (!condition) return false

  const cond = typeof condition === 'function' ? condition() : condition
  if (!cond) return false

  if (cond.field === 'operation' && !cond.not) {
    const values = Array.isArray(cond.value) ? cond.value : [cond.value]
    return values.includes(operation)
  }

  return false
}

/**
 * Extracts input schema from subBlocks
 */
function extractInputsFromSubBlocks(
  subBlocks: SubBlockConfig[],
  operation?: string
): Record<string, InputFieldSchema> {
  const inputs: Record<string, InputFieldSchema> = {}

  for (const sb of subBlocks) {
    // Skip trigger-mode subBlocks
    if (sb.mode === 'trigger') continue

    // Skip hidden subBlocks
    if (sb.hidden) continue

    // If operation is specified, only include subBlocks that:
    // 1. Have no condition (common parameters)
    // 2. Have a condition matching the operation
    if (operation) {
      const condition = typeof sb.condition === 'function' ? sb.condition() : sb.condition
      if (condition) {
        if (condition.field === 'operation' && !condition.not) {
          // This is an operation-specific field
          const values = Array.isArray(condition.value) ? condition.value : [condition.value]
          if (!values.includes(operation)) {
            continue // Skip if doesn't match our operation
          }
        } else if (!matchesOperation(condition, operation)) {
          // Other condition that doesn't match
          continue
        }
      }
    }

    const field: InputFieldSchema = {
      type: mapSubBlockTypeToSchemaType(sb.type),
    }

    if (sb.description) field.description = sb.description
    if (sb.title && !sb.description) field.description = sb.title
    if (sb.placeholder) field.placeholder = sb.placeholder

    // Handle required
    if (typeof sb.required === 'boolean') {
      field.required = sb.required
    } else if (typeof sb.required === 'object') {
      field.required = true // Has conditional requirement
    }

    // Handle options using the resolver that handles dynamic model lists
    const resolvedOptions = resolveSubBlockOptions(sb)
    if (resolvedOptions && resolvedOptions.length > 0) {
      field.options = resolvedOptions
    }

    // Handle default value
    if (sb.defaultValue !== undefined) {
      field.default = sb.defaultValue
    }

    // Handle numeric constraints
    if (sb.min !== undefined) field.min = sb.min
    if (sb.max !== undefined) field.max = sb.max

    inputs[sb.id] = field
  }

  return inputs
}

/**
 * Maps subBlock type to a simplified schema type
 */
function mapSubBlockTypeToSchemaType(type: string): string {
  const typeMap: Record<string, string> = {
    'short-input': 'string',
    'long-input': 'string',
    code: 'string',
    dropdown: 'string',
    combobox: 'string',
    slider: 'number',
    switch: 'boolean',
    'tool-input': 'json',
    'checkbox-list': 'array',
    'grouped-checkbox-list': 'array',
    'condition-input': 'json',
    'eval-input': 'json',
    'time-input': 'string',
    'oauth-input': 'credential',
    'file-selector': 'string',
    'project-selector': 'string',
    'channel-selector': 'string',
    'user-selector': 'string',
    'folder-selector': 'string',
    'knowledge-base-selector': 'string',
    'document-selector': 'string',
    'mcp-server-selector': 'string',
    'mcp-tool-selector': 'string',
    table: 'json',
    'file-upload': 'file',
    'messages-input': 'array',
  }

  return typeMap[type] || 'string'
}

/**
 * Extracts output schema from block config or tool
 */
function extractOutputs(blockConfig: any, operation?: string): Record<string, OutputFieldSchema> {
  const outputs: Record<string, OutputFieldSchema> = {}

  // If operation is specified, try to get outputs from the specific tool
  if (operation) {
    try {
      const toolSelector = blockConfig.tools?.config?.tool
      if (typeof toolSelector === 'function') {
        const toolId = toolSelector({ operation })
        const tool = toolsRegistry[toolId]
        if (tool?.outputs) {
          for (const [key, def] of Object.entries(tool.outputs)) {
            const typedDef = def as { type: string; description?: string }
            outputs[key] = {
              type: typedDef.type || 'any',
              description: typedDef.description,
            }
          }
          return outputs
        }
      }
    } catch {
      // Fall through to block-level outputs
    }
  }

  // Use block-level outputs
  if (blockConfig.outputs) {
    for (const [key, def] of Object.entries(blockConfig.outputs)) {
      if (typeof def === 'string') {
        outputs[key] = { type: def }
      } else if (typeof def === 'object' && def !== null) {
        const typedDef = def as { type?: string; description?: string }
        outputs[key] = {
          type: typedDef.type || 'any',
          description: typedDef.description,
        }
      }
    }
  }

  return outputs
}

export const getBlockConfigServerTool: BaseServerTool<
  GetBlockConfigInputType,
  GetBlockConfigResultType
> = {
  name: 'get_block_config',
  async execute(
    { blockType, operation }: GetBlockConfigInputType,
    context?: { userId: string }
  ): Promise<GetBlockConfigResultType> {
    const logger = createLogger('GetBlockConfigServerTool')
    logger.debug('Executing get_block_config', { blockType, operation })

    const permissionConfig = context?.userId ? await getUserPermissionConfig(context.userId) : null
    const allowedIntegrations = permissionConfig?.allowedIntegrations

    if (allowedIntegrations !== null && !allowedIntegrations?.includes(blockType)) {
      throw new Error(`Block "${blockType}" is not available`)
    }

    const blockConfig = blockRegistry[blockType]
    if (!blockConfig) {
      throw new Error(`Block not found: ${blockType}`)
    }

    // If operation is specified, validate it exists
    if (operation) {
      const operationSubBlock = blockConfig.subBlocks?.find((sb) => sb.id === 'operation')
      if (operationSubBlock && Array.isArray(operationSubBlock.options)) {
        const validOperations = operationSubBlock.options.map((o) =>
          typeof o === 'object' ? o.id : o
        )
        if (!validOperations.includes(operation)) {
          throw new Error(
            `Invalid operation "${operation}" for block "${blockType}". Valid operations: ${validOperations.join(', ')}`
          )
        }
      }
    }

    const subBlocks = Array.isArray(blockConfig.subBlocks) ? blockConfig.subBlocks : []
    const inputs = extractInputsFromSubBlocks(subBlocks, operation)
    const outputs = extractOutputs(blockConfig, operation)

    const result = {
      blockType,
      blockName: blockConfig.name,
      operation,
      inputs,
      outputs,
    }

    return GetBlockConfigResult.parse(result)
  },
}
