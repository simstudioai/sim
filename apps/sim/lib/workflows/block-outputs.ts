import { classifyStartBlockType, StartBlockPath, TRIGGER_TYPES } from '@/lib/workflows/triggers'
import {
  type InputFormatField,
  START_BLOCK_RESERVED_FIELDS,
  USER_FILE_ACCESSIBLE_PROPERTIES,
  USER_FILE_PROPERTY_TYPES,
} from '@/lib/workflows/types'
import { getBlock } from '@/blocks'
import type { BlockConfig } from '@/blocks/types'
import { getTrigger, isTriggerValid } from '@/triggers'

type OutputDefinition = Record<string, any>

const CHAT_OUTPUTS: OutputDefinition = {
  input: { type: 'string', description: 'User message' },
  conversationId: { type: 'string', description: 'Conversation ID' },
  files: { type: 'files', description: 'Uploaded files' },
}

const UNIFIED_START_OUTPUTS: OutputDefinition = {
  input: { type: 'string', description: 'Primary user input or message' },
  conversationId: { type: 'string', description: 'Conversation thread identifier' },
  files: { type: 'files', description: 'User uploaded files' },
}

function normalizeInputFormatValue(inputFormatValue: any): InputFormatField[] {
  if (
    inputFormatValue === null ||
    inputFormatValue === undefined ||
    (Array.isArray(inputFormatValue) && inputFormatValue.length === 0)
  ) {
    return []
  }

  if (!Array.isArray(inputFormatValue)) {
    return []
  }

  return inputFormatValue.filter(
    (field) => field && typeof field === 'object' && field.name && field.name.trim() !== ''
  )
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
  subBlocks: Record<string, any> | undefined,
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

function getUnifiedStartOutputs(subBlocks: Record<string, any> | undefined): OutputDefinition {
  const outputs = { ...UNIFIED_START_OUTPUTS }
  const normalizedInputFormat = normalizeInputFormatValue(subBlocks?.inputFormat?.value)
  return applyInputFormatFields(normalizedInputFormat, outputs)
}

function getLegacyStarterOutputs(subBlocks: Record<string, any> | undefined): OutputDefinition {
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
  subBlocks: Record<string, any> | undefined,
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
  subBlocks?: Record<string, any>,
  triggerMode?: boolean
): OutputDefinition {
  const blockConfig = getBlock(blockType)
  if (!blockConfig) return {}

  if (triggerMode && blockConfig.triggers?.enabled) {
    const triggerId = getTriggerId(subBlocks, blockConfig)
    if (triggerId && isTriggerValid(triggerId)) {
      const trigger = getTrigger(triggerId)
      if (trigger.outputs) {
        return trigger.outputs
      }
    }
  }

  const startPath = classifyStartBlockType(blockType)

  if (startPath === StartBlockPath.UNIFIED) {
    return getUnifiedStartOutputs(subBlocks)
  }

  if (blockType === 'approval') {
    // Start with only url (apiUrl commented out - not accessible as output)
    const pauseResumeOutputs: Record<string, any> = {
      url: { type: 'string', description: 'Resume UI URL' },
      // apiUrl: { type: 'string', description: 'Resume API URL' }, // Commented out - not accessible as output
    }

    const normalizedInputFormat = normalizeInputFormatValue(subBlocks?.inputFormat?.value)

    // Add each input format field as a top-level output
    for (const field of normalizedInputFormat) {
      const fieldName = field?.name?.trim()
      if (!fieldName) continue

      pauseResumeOutputs[fieldName] = {
        type: (field?.type || 'any') as any,
        description: `Field from input format`,
      }
    }

    return pauseResumeOutputs
  }

  if (startPath === StartBlockPath.LEGACY_STARTER) {
    return getLegacyStarterOutputs(subBlocks)
  }

  const baseOutputs = { ...(blockConfig.outputs || {}) }
  return applyInputFormatToOutputs(blockType, blockConfig, subBlocks, baseOutputs)
}

function shouldFilterReservedField(
  blockType: string,
  key: string,
  prefix: string,
  subBlocks: Record<string, any> | undefined
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

function collectOutputPaths(
  obj: OutputDefinition,
  blockType: string,
  subBlocks: Record<string, any> | undefined,
  prefix = ''
): string[] {
  const paths: string[] = []

  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key

    if (shouldFilterReservedField(blockType, key, prefix, subBlocks)) {
      continue
    }

    if (value && typeof value === 'object' && 'type' in value) {
      if (value.type === 'files') {
        paths.push(...expandFileTypeProperties(path))
      } else {
        paths.push(path)
      }
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      paths.push(...collectOutputPaths(value, blockType, subBlocks, path))
    } else {
      paths.push(path)
    }
  }

  return paths
}

export function getBlockOutputPaths(
  blockType: string,
  subBlocks?: Record<string, any>,
  triggerMode?: boolean
): string[] {
  const outputs = getBlockOutputs(blockType, subBlocks, triggerMode)
  return collectOutputPaths(outputs, blockType, subBlocks)
}

function getFilePropertyType(outputs: OutputDefinition, pathParts: string[]): string | null {
  const lastPart = pathParts[pathParts.length - 1]
  if (!lastPart || !USER_FILE_PROPERTY_TYPES[lastPart as keyof typeof USER_FILE_PROPERTY_TYPES]) {
    return null
  }

  let current: any = outputs
  for (const part of pathParts.slice(0, -1)) {
    if (!current || typeof current !== 'object') {
      return null
    }
    current = current[part]
  }

  if (current && typeof current === 'object' && 'type' in current && current.type === 'files') {
    return USER_FILE_PROPERTY_TYPES[lastPart as keyof typeof USER_FILE_PROPERTY_TYPES]
  }

  return null
}

function traverseOutputPath(outputs: OutputDefinition, pathParts: string[]): any {
  let current: any = outputs

  for (const part of pathParts) {
    if (!current || typeof current !== 'object') {
      return null
    }
    current = current[part]
  }

  return current
}

function extractType(value: any): string {
  if (!value) return 'any'

  if (typeof value === 'object' && 'type' in value) {
    return value.type
  }

  return typeof value === 'string' ? value : 'any'
}

export function getBlockOutputType(
  blockType: string,
  outputPath: string,
  subBlocks?: Record<string, any>,
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
