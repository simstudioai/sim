import { createLogger } from '@sim/logger'
import {
  extractFieldsFromSchema,
  parseResponseFormatSafely,
} from '@/lib/core/utils/response-format'
import { normalizeInputFormatValue } from '@/lib/workflows/input-format'
import {
  classifyStartBlockType,
  StartBlockPath,
  TRIGGER_TYPES,
} from '@/lib/workflows/triggers/triggers'
import {
  type InputFormatField,
  START_BLOCK_RESERVED_FIELDS,
  USER_FILE_ACCESSIBLE_PROPERTIES,
  USER_FILE_PROPERTY_TYPES,
} from '@/lib/workflows/types'
import { getBlock } from '@/blocks'
import {
  type BlockConfig,
  isHiddenFromDisplay,
  type OutputCondition,
  type OutputFieldDefinition,
} from '@/blocks/types'
import { getTool } from '@/tools/utils'
import { getTrigger, isTriggerValid } from '@/triggers'

const logger = createLogger('BlockOutputs')

type OutputDefinition = Record<string, OutputFieldDefinition>

interface SubBlockWithValue {
  value?: unknown
}

type ConditionValue = string | number | boolean

/**
 * Checks if a value is a valid primitive for condition comparison.
 */
function isConditionPrimitive(value: unknown): value is ConditionValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

/**
 * Evaluates an output condition against subBlock values.
 * Returns true if the condition is met and the output should be shown.
 */
function evaluateOutputCondition(
  condition: OutputCondition,
  subBlocks: Record<string, SubBlockWithValue> | undefined
): boolean {
  if (!subBlocks) return false

  const fieldValue = subBlocks[condition.field]?.value

  let matches: boolean
  if (Array.isArray(condition.value)) {
    // For array conditions, check if fieldValue is a valid primitive and included
    matches = isConditionPrimitive(fieldValue) && condition.value.includes(fieldValue)
  } else {
    matches = fieldValue === condition.value
  }

  if (condition.not) {
    matches = !matches
  }

  if (condition.and) {
    const andFieldValue = subBlocks[condition.and.field]?.value
    let andMatches: boolean

    if (Array.isArray(condition.and.value)) {
      const primitiveMatch =
        isConditionPrimitive(andFieldValue) && condition.and.value.includes(andFieldValue)
      const undefinedMatch = andFieldValue === undefined && condition.and.value.includes(undefined)
      const nullMatch = andFieldValue === null && condition.and.value.includes(null)
      andMatches = primitiveMatch || undefinedMatch || nullMatch
    } else {
      andMatches = andFieldValue === condition.and.value
    }

    if (condition.and.not) {
      andMatches = !andMatches
    }

    matches = matches && andMatches
  }

  return matches
}

/**
 * Filters outputs based on their conditions and hiddenFromDisplay flag.
 * Returns a new OutputDefinition with only the outputs that should be shown.
 */
function filterOutputsByCondition(
  outputs: OutputDefinition,
  subBlocks: Record<string, SubBlockWithValue> | undefined
): OutputDefinition {
  const filtered: OutputDefinition = {}

  for (const [key, value] of Object.entries(outputs)) {
    if (isHiddenFromDisplay(value)) continue

    if (!value || typeof value !== 'object' || !('condition' in value)) {
      filtered[key] = value
      continue
    }

    const condition = value.condition as OutputCondition | undefined
    const passes = !condition || evaluateOutputCondition(condition, subBlocks)

    if (passes) {
      const { condition: _, hiddenFromDisplay: __, ...rest } = value
      filtered[key] = rest
    }
  }

  return filtered
}

const CHAT_OUTPUTS: OutputDefinition = {
  input: { type: 'string', description: 'User message' },
  conversationId: { type: 'string', description: 'Conversation ID' },
  files: { type: 'file[]', description: 'Uploaded files' },
}

const UNIFIED_START_OUTPUTS: OutputDefinition = {
  input: { type: 'string', description: 'Primary user input or message' },
  conversationId: { type: 'string', description: 'Conversation thread identifier' },
  files: { type: 'file[]', description: 'User uploaded files' },
}

function applyInputFormatFields(
  inputFormat: InputFormatField[],
  outputs: OutputDefinition
): OutputDefinition {
  for (const field of inputFormat) {
    const fieldName = field?.name?.trim()
    if (!fieldName) continue

    outputs[fieldName] = {
      type: (field?.type || 'any') as any,
      description: `Field from input format`,
    }
  }

  return outputs
}

function hasInputFormat(blockConfig: BlockConfig): boolean {
  return blockConfig.subBlocks?.some((sb) => sb.type === 'input-format') || false
}

function getTriggerId(
  subBlocks: Record<string, SubBlockWithValue> | undefined,
  blockConfig: BlockConfig
): string | undefined {
  const selectedTriggerIdValue = subBlocks?.selectedTriggerId?.value
  const triggerIdValue = subBlocks?.triggerId?.value

  return (
    (typeof selectedTriggerIdValue === 'string' && isTriggerValid(selectedTriggerIdValue)
      ? selectedTriggerIdValue
      : undefined) ||
    (typeof triggerIdValue === 'string' && isTriggerValid(triggerIdValue)
      ? triggerIdValue
      : undefined) ||
    blockConfig.triggers?.available?.[0]
  )
}

function getUnifiedStartOutputs(
  subBlocks: Record<string, SubBlockWithValue> | undefined
): OutputDefinition {
  const outputs = { ...UNIFIED_START_OUTPUTS }
  const normalizedInputFormat = normalizeInputFormatValue(subBlocks?.inputFormat?.value)
  return applyInputFormatFields(normalizedInputFormat, outputs)
}

function getLegacyStarterOutputs(
  subBlocks: Record<string, SubBlockWithValue> | undefined
): OutputDefinition {
  const startWorkflowValue = subBlocks?.startWorkflow?.value

  if (startWorkflowValue === 'chat') {
    return { ...CHAT_OUTPUTS }
  }

  if (
    startWorkflowValue === 'api' ||
    startWorkflowValue === 'run' ||
    startWorkflowValue === 'manual'
  ) {
    const normalizedInputFormat = normalizeInputFormatValue(subBlocks?.inputFormat?.value)
    return applyInputFormatFields(normalizedInputFormat, {})
  }

  return {}
}

function shouldClearBaseOutputs(
  blockType: string,
  normalizedInputFormat: InputFormatField[]
): boolean {
  if (blockType === TRIGGER_TYPES.API || blockType === TRIGGER_TYPES.INPUT) {
    return true
  }

  if (blockType === TRIGGER_TYPES.GENERIC_WEBHOOK && normalizedInputFormat.length > 0) {
    return true
  }

  return false
}

function applyInputFormatToOutputs(
  blockType: string,
  blockConfig: BlockConfig,
  subBlocks: Record<string, SubBlockWithValue> | undefined,
  baseOutputs: OutputDefinition
): OutputDefinition {
  if (!hasInputFormat(blockConfig) || !subBlocks?.inputFormat?.value) {
    return baseOutputs
  }

  const normalizedInputFormat = normalizeInputFormatValue(subBlocks.inputFormat.value)

  if (!Array.isArray(subBlocks.inputFormat.value)) {
    if (blockType === TRIGGER_TYPES.API || blockType === TRIGGER_TYPES.INPUT) {
      return {}
    }
    return baseOutputs
  }

  const shouldClear = shouldClearBaseOutputs(blockType, normalizedInputFormat)
  const outputs = shouldClear ? {} : { ...baseOutputs }

  return applyInputFormatFields(normalizedInputFormat, outputs)
}

export function getBlockOutputs(
  blockType: string,
  subBlocks?: Record<string, SubBlockWithValue>,
  triggerMode?: boolean
): OutputDefinition {
  const blockConfig = getBlock(blockType)
  if (!blockConfig) return {}

  if (triggerMode && blockConfig.triggers?.enabled) {
    const triggerId = getTriggerId(subBlocks, blockConfig)
    if (triggerId && isTriggerValid(triggerId)) {
      const trigger = getTrigger(triggerId)
      if (trigger.outputs) {
        // TriggerOutput is compatible with OutputFieldDefinition at runtime
        return trigger.outputs as OutputDefinition
      }
    }
  }

  const startPath = classifyStartBlockType(blockType)

  if (startPath === StartBlockPath.UNIFIED) {
    return getUnifiedStartOutputs(subBlocks)
  }

  if (blockType === 'human_in_the_loop') {
    // Start with block config outputs (respects hiddenFromDisplay via filterOutputsByCondition)
    const baseOutputs = filterOutputsByCondition(
      { ...(blockConfig.outputs || {}) } as OutputDefinition,
      subBlocks
    )

    // Add inputFormat fields (resume form fields)
    const normalizedInputFormat = normalizeInputFormatValue(subBlocks?.inputFormat?.value)

    for (const field of normalizedInputFormat) {
      const fieldName = field?.name?.trim()
      if (!fieldName) continue

      baseOutputs[fieldName] = {
        type: (field?.type || 'any') as any,
        description: field?.description || `Field from resume form`,
      }
    }

    return baseOutputs
  }

  if (startPath === StartBlockPath.LEGACY_STARTER) {
    return getLegacyStarterOutputs(subBlocks)
  }

  if (blockType === 'agent') {
    const responseFormatValue = subBlocks?.responseFormat?.value
    if (responseFormatValue) {
      const parsed = parseResponseFormatSafely(responseFormatValue, 'agent')
      if (parsed) {
        const fields = extractFieldsFromSchema(parsed)
        if (fields.length > 0) {
          const outputs: OutputDefinition = {}
          for (const field of fields) {
            outputs[field.name] = {
              type: (field.type || 'any') as any,
              description: field.description || `Field from Agent: ${field.name}`,
            }
          }
          return outputs
        }
      }
    }
  }

  const baseOutputs = { ...(blockConfig.outputs || {}) }
  const filteredOutputs = filterOutputsByCondition(baseOutputs, subBlocks)
  return applyInputFormatToOutputs(blockType, blockConfig, subBlocks, filteredOutputs)
}

function shouldFilterReservedField(
  blockType: string,
  key: string,
  prefix: string,
  subBlocks: Record<string, SubBlockWithValue> | undefined
): boolean {
  if (blockType !== TRIGGER_TYPES.START || prefix) {
    return false
  }

  if (!START_BLOCK_RESERVED_FIELDS.includes(key as any)) {
    return false
  }

  const normalizedInputFormat = normalizeInputFormatValue(subBlocks?.inputFormat?.value)
  const isExplicitlyDefined = normalizedInputFormat.some((field) => field?.name?.trim() === key)

  return !isExplicitlyDefined
}

function expandFileTypeProperties(path: string): string[] {
  return USER_FILE_ACCESSIBLE_PROPERTIES.map((prop) => `${path}.${prop}`)
}

type FileOutputType = 'file' | 'file[]'

function isFileOutputDefinition(value: unknown): value is { type: FileOutputType } {
  if (!value || typeof value !== 'object' || !('type' in value)) {
    return false
  }

  const { type } = value as { type?: unknown }
  return type === 'file' || type === 'file[]'
}

export function getBlockOutputPaths(
  blockType: string,
  subBlocks?: Record<string, SubBlockWithValue>,
  triggerMode?: boolean
): string[] {
  const outputs = getBlockOutputs(blockType, subBlocks, triggerMode)
  const paths = generateOutputPaths(outputs)

  if (blockType === TRIGGER_TYPES.START) {
    return paths.filter((path) => {
      const key = path.split('.')[0]
      return !shouldFilterReservedField(blockType, key, '', subBlocks)
    })
  }

  return paths
}

function getFilePropertyType(outputs: OutputDefinition, pathParts: string[]): string | null {
  const lastPart = pathParts[pathParts.length - 1]
  if (!lastPart || !USER_FILE_PROPERTY_TYPES[lastPart as keyof typeof USER_FILE_PROPERTY_TYPES]) {
    return null
  }

  let current: unknown = outputs
  for (const part of pathParts.slice(0, -1)) {
    if (!current || typeof current !== 'object') {
      return null
    }
    current = (current as Record<string, unknown>)[part]
  }

  if (isFileOutputDefinition(current)) {
    return USER_FILE_PROPERTY_TYPES[lastPart as keyof typeof USER_FILE_PROPERTY_TYPES]
  }

  return null
}

function traverseOutputPath(outputs: OutputDefinition, pathParts: string[]): unknown {
  let current: unknown = outputs

  for (const part of pathParts) {
    if (!current || typeof current !== 'object') {
      return null
    }

    const currentObj = current as Record<string, unknown>

    if (part in currentObj) {
      current = currentObj[part]
    } else if (
      'type' in currentObj &&
      currentObj.type === 'object' &&
      'properties' in currentObj &&
      currentObj.properties &&
      typeof currentObj.properties === 'object'
    ) {
      const props = currentObj.properties as Record<string, unknown>
      if (part in props) {
        current = props[part]
      } else {
        return null
      }
    } else if (
      'type' in currentObj &&
      currentObj.type === 'array' &&
      'items' in currentObj &&
      currentObj.items &&
      typeof currentObj.items === 'object'
    ) {
      const items = currentObj.items as Record<string, unknown>
      if ('properties' in items && items.properties && typeof items.properties === 'object') {
        const itemProps = items.properties as Record<string, unknown>
        if (part in itemProps) {
          current = itemProps[part]
        } else {
          return null
        }
      } else {
        return null
      }
    } else {
      return null
    }
  }

  return current
}

function extractType(value: unknown): string {
  if (!value) return 'any'

  if (typeof value === 'object' && 'type' in value) {
    const typeValue = (value as { type: unknown }).type
    return typeof typeValue === 'string' ? typeValue : 'any'
  }

  return typeof value === 'string' ? value : 'any'
}

export function getBlockOutputType(
  blockType: string,
  outputPath: string,
  subBlocks?: Record<string, SubBlockWithValue>,
  triggerMode?: boolean
): string {
  const outputs = getBlockOutputs(blockType, subBlocks, triggerMode)

  const cleanPath = outputPath.replace(/\[(\d+)\]/g, '')
  const pathParts = cleanPath.split('.').filter(Boolean)

  const filePropertyType = getFilePropertyType(outputs, pathParts)
  if (filePropertyType) {
    return filePropertyType
  }

  const value = traverseOutputPath(outputs, pathParts)
  return extractType(value)
}

/**
 * Recursively generates all output paths from an outputs schema.
 *
 * @param outputs - The outputs schema object
 * @param prefix - Current path prefix for recursion
 * @returns Array of dot-separated paths to all output fields
 */
function generateOutputPaths(outputs: Record<string, any>, prefix = ''): string[] {
  const paths: string[] = []

  for (const [key, value] of Object.entries(outputs)) {
    const currentPath = prefix ? `${prefix}.${key}` : key

    if (typeof value === 'string') {
      paths.push(currentPath)
    } else if (typeof value === 'object' && value !== null) {
      if ('type' in value && typeof value.type === 'string') {
        if (isFileOutputDefinition(value)) {
          paths.push(...expandFileTypeProperties(currentPath))
          continue
        }

        const hasNestedProperties =
          ((value.type === 'object' || value.type === 'json') && value.properties) ||
          (value.type === 'array' && value.items?.properties) ||
          (value.type === 'array' &&
            value.items &&
            typeof value.items === 'object' &&
            !('type' in value.items))

        if (!hasNestedProperties) {
          paths.push(currentPath)
        }

        if ((value.type === 'object' || value.type === 'json') && value.properties) {
          paths.push(...generateOutputPaths(value.properties, currentPath))
        } else if (value.type === 'array' && value.items?.properties) {
          paths.push(...generateOutputPaths(value.items.properties, currentPath))
        } else if (
          value.type === 'array' &&
          value.items &&
          typeof value.items === 'object' &&
          !('type' in value.items)
        ) {
          paths.push(...generateOutputPaths(value.items, currentPath))
        }
      } else {
        const subPaths = generateOutputPaths(value, currentPath)
        paths.push(...subPaths)
      }
    } else {
      paths.push(currentPath)
    }
  }

  return paths
}

/**
 * Recursively generates all output paths with their types from an outputs schema.
 *
 * @param outputs - The outputs schema object
 * @param prefix - Current path prefix for recursion
 * @returns Array of objects containing path and type for each output field
 */
function generateOutputPathsWithTypes(
  outputs: Record<string, any>,
  prefix = ''
): Array<{ path: string; type: string }> {
  const paths: Array<{ path: string; type: string }> = []

  for (const [key, value] of Object.entries(outputs)) {
    const currentPath = prefix ? `${prefix}.${key}` : key

    if (typeof value === 'string') {
      paths.push({ path: currentPath, type: value })
    } else if (typeof value === 'object' && value !== null) {
      if ('type' in value && typeof value.type === 'string') {
        if (isFileOutputDefinition(value)) {
          paths.push({ path: currentPath, type: value.type })
          for (const prop of USER_FILE_ACCESSIBLE_PROPERTIES) {
            paths.push({
              path: `${currentPath}.${prop}`,
              type: USER_FILE_PROPERTY_TYPES[prop as keyof typeof USER_FILE_PROPERTY_TYPES],
            })
          }
          continue
        }

        if (value.type === 'array' && value.items?.properties) {
          paths.push({ path: currentPath, type: 'array' })
          const subPaths = generateOutputPathsWithTypes(value.items.properties, currentPath)
          paths.push(...subPaths)
        } else if ((value.type === 'object' || value.type === 'json') && value.properties) {
          paths.push({ path: currentPath, type: value.type })
          const subPaths = generateOutputPathsWithTypes(value.properties, currentPath)
          paths.push(...subPaths)
        } else {
          paths.push({ path: currentPath, type: value.type })
        }
      } else {
        const subPaths = generateOutputPathsWithTypes(value, currentPath)
        paths.push(...subPaths)
      }
    } else {
      paths.push({ path: currentPath, type: 'any' })
    }
  }

  return paths
}

/**
 * Gets the tool outputs for a block operation.
 *
 * @param blockConfig - The block configuration containing tools config
 * @param subBlocks - SubBlock values to pass to the tool selector
 * @returns Outputs schema for the tool, or empty object on error
 */
export function getToolOutputs(
  blockConfig: BlockConfig,
  subBlocks?: Record<string, SubBlockWithValue>
): Record<string, any> {
  if (!blockConfig?.tools?.config?.tool) return {}

  try {
    // Build params object from subBlock values for tool selector
    // This allows tool selectors to use any field (operation, provider, etc.)
    const params: Record<string, any> = {}
    if (subBlocks) {
      for (const [key, subBlock] of Object.entries(subBlocks)) {
        params[key] = subBlock.value
      }
    }

    const toolId = blockConfig.tools.config.tool(params)
    if (!toolId) return {}

    const toolConfig = getTool(toolId)
    if (!toolConfig?.outputs) return {}

    return toolConfig.outputs
  } catch (error) {
    logger.warn('Failed to get tool outputs', { error })
    return {}
  }
}

export function getToolOutputPaths(
  blockConfig: BlockConfig,
  subBlocks?: Record<string, SubBlockWithValue>
): string[] {
  const outputs = getToolOutputs(blockConfig, subBlocks)

  if (!outputs || Object.keys(outputs).length === 0) return []

  if (subBlocks && blockConfig.outputs) {
    const filteredOutputs: Record<string, any> = {}

    for (const [key, value] of Object.entries(outputs)) {
      const blockOutput = blockConfig.outputs[key]

      if (!blockOutput || typeof blockOutput !== 'object') {
        filteredOutputs[key] = value
        continue
      }

      const condition = 'condition' in blockOutput ? blockOutput.condition : undefined
      if (condition) {
        if (evaluateOutputCondition(condition, subBlocks)) {
          filteredOutputs[key] = value
        }
      } else {
        filteredOutputs[key] = value
      }
    }

    return generateOutputPaths(filteredOutputs)
  }

  return generateOutputPaths(outputs)
}

/**
 * Generates output paths from a schema definition.
 *
 * @param outputs - The outputs schema object
 * @returns Array of dot-separated paths to all output fields
 */
export function getOutputPathsFromSchema(outputs: Record<string, any>): string[] {
  return generateOutputPaths(outputs)
}

/**
 * Gets the output type for a specific path in a tool's outputs.
 *
 * @param blockConfig - The block configuration containing tools config
 * @param subBlocks - SubBlock values for tool selection
 * @param path - The dot-separated path to the output field
 * @returns The type of the output field, or 'any' if not found
 */
export function getToolOutputType(
  blockConfig: BlockConfig,
  subBlocks: Record<string, SubBlockWithValue> | undefined,
  path: string
): string {
  const outputs = getToolOutputs(blockConfig, subBlocks)
  if (!outputs || Object.keys(outputs).length === 0) return 'any'

  const pathsWithTypes = generateOutputPathsWithTypes(outputs)
  const matchingPath = pathsWithTypes.find((p) => p.path === path)
  return matchingPath?.type || 'any'
}
