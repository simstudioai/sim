import { classifyStartBlockType, StartBlockPath } from '@/lib/workflows/triggers'
import { getBlock } from '@/blocks'
import type { BlockConfig } from '@/blocks/types'
import { getTrigger, isTriggerValid } from '@/triggers'

type InputFormatField = { name?: string; type?: string | undefined | null }

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

  return inputFormatValue.filter((field) => field && typeof field === 'object')
}

function applyInputFormatFields(
  inputFormat: InputFormatField[],
  outputs: Record<string, any>
): Record<string, any> {
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

/**
 * Get the effective outputs for a block, including dynamic outputs from inputFormat
 * and trigger outputs for blocks in trigger mode
 */
export function getBlockOutputs(
  blockType: string,
  subBlocks?: Record<string, any>,
  triggerMode?: boolean
): Record<string, any> {
  const blockConfig = getBlock(blockType)
  if (!blockConfig) return {}

  if (triggerMode && blockConfig.triggers?.enabled) {
    const selectedTriggerIdValue = subBlocks?.selectedTriggerId?.value
    const triggerIdValue = subBlocks?.triggerId?.value
    const triggerId =
      (typeof selectedTriggerIdValue === 'string' && isTriggerValid(selectedTriggerIdValue)
        ? selectedTriggerIdValue
        : undefined) ||
      (typeof triggerIdValue === 'string' && isTriggerValid(triggerIdValue)
        ? triggerIdValue
        : undefined) ||
      blockConfig.triggers?.available?.[0]
    if (triggerId && isTriggerValid(triggerId)) {
      const trigger = getTrigger(triggerId)
      if (trigger.outputs) {
        return trigger.outputs
      }
    }
  }

  let outputs = { ...(blockConfig.outputs || {}) }

  const startPath = classifyStartBlockType(blockType)

  if (startPath === StartBlockPath.UNIFIED) {
    outputs = {
      input: { type: 'string', description: 'Primary user input or message' },
      conversationId: { type: 'string', description: 'Conversation thread identifier' },
      files: { type: 'files', description: 'User uploaded files' },
    }

    const normalizedInputFormat = normalizeInputFormatValue(subBlocks?.inputFormat?.value)
    for (const field of normalizedInputFormat) {
      const fieldName = field?.name?.trim()
      if (!fieldName) continue

      outputs[fieldName] = {
        type: (field?.type || 'any') as any,
        description: `Field from input format`,
      }
    }

    return outputs
  }

  if (blockType === 'approval') {
    // Start with only uiUrl and apiUrl (from base outputs)
    const pauseResumeOutputs: Record<string, any> = {
      uiUrl: { type: 'string', description: 'Resume UI URL' },
      apiUrl: { type: 'string', description: 'Resume API URL' },
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

  // Special handling for starter block (legacy)
  if (startPath === StartBlockPath.LEGACY_STARTER) {
    const startWorkflowValue = subBlocks?.startWorkflow?.value

    if (startWorkflowValue === 'chat') {
      // Chat mode outputs
      return {
        input: { type: 'string', description: 'User message' },
        conversationId: { type: 'string', description: 'Conversation ID' },
        files: { type: 'files', description: 'Uploaded files' },
      }
    }
    if (
      startWorkflowValue === 'api' ||
      startWorkflowValue === 'run' ||
      startWorkflowValue === 'manual'
    ) {
      // API/manual mode - use inputFormat fields only
      const normalizedInputFormat = normalizeInputFormatValue(subBlocks?.inputFormat?.value)
      outputs = {}
      return applyInputFormatFields(normalizedInputFormat, outputs)
    }
  }

  // For blocks with inputFormat, add dynamic outputs
  if (hasInputFormat(blockConfig) && subBlocks?.inputFormat?.value) {
    const normalizedInputFormat = normalizeInputFormatValue(subBlocks.inputFormat.value)

    if (!Array.isArray(subBlocks.inputFormat.value)) {
      if (blockType === 'api_trigger' || blockType === 'input_trigger') {
        outputs = {}
      }
    } else {
      if (
        blockType === 'api_trigger' ||
        blockType === 'input_trigger' ||
        blockType === 'generic_webhook'
      ) {
        if (normalizedInputFormat.length > 0 || blockType !== 'generic_webhook') {
          outputs = {}
        }
        outputs = applyInputFormatFields(normalizedInputFormat, outputs)
      }
    }

    if (
      !Array.isArray(subBlocks.inputFormat.value) &&
      (blockType === 'api_trigger' || blockType === 'input_trigger')
    ) {
      // If no inputFormat defined, API/Input trigger has no outputs
      outputs = {}
    }
  }

  return outputs
}

/**
 * Check if a block config has an inputFormat sub-block
 */
function hasInputFormat(blockConfig: BlockConfig): boolean {
  return blockConfig.subBlocks?.some((sb) => sb.type === 'input-format') || false
}

/**
 * Get output paths for a block (for tag dropdown)
 */
export function getBlockOutputPaths(
  blockType: string,
  subBlocks?: Record<string, any>,
  triggerMode?: boolean
): string[] {
  const outputs = getBlockOutputs(blockType, subBlocks, triggerMode)

  // Recursively collect all paths from nested outputs
  const paths: string[] = []

  function collectPaths(obj: Record<string, any>, prefix = ''): void {
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key

      // For start_trigger, skip reserved fields at root level (they're always present but hidden from dropdown)
      if (
        blockType === 'start_trigger' &&
        !prefix &&
        ['input', 'conversationId', 'files'].includes(key)
      ) {
        continue
      }

      // If value has 'type' property, it's a leaf node (output definition)
      if (value && typeof value === 'object' && 'type' in value) {
        // Special handling for 'files' type - expand to show array element properties
        if (value.type === 'files') {
          // Show properties without [0] for cleaner display
          // The tag dropdown will add [0] automatically when inserting
          paths.push(`${path}.url`)
          paths.push(`${path}.name`)
          paths.push(`${path}.size`)
          paths.push(`${path}.type`)
          paths.push(`${path}.key`)
          paths.push(`${path}.uploadedAt`)
          paths.push(`${path}.expiresAt`)
        } else {
          paths.push(path)
        }
      }
      // If value is an object without 'type', recurse into it
      else if (value && typeof value === 'object' && !Array.isArray(value)) {
        collectPaths(value, path)
      }
      // Otherwise treat as a leaf node
      else {
        paths.push(path)
      }
    }
  }

  collectPaths(outputs)
  return paths
}

/**
 * Get the type of a specific output path (supports nested paths like "email.subject")
 */
export function getBlockOutputType(
  blockType: string,
  outputPath: string,
  subBlocks?: Record<string, any>,
  triggerMode?: boolean
): string {
  const outputs = getBlockOutputs(blockType, subBlocks, triggerMode)

  const arrayIndexRegex = /\[(\d+)\]/g
  const cleanPath = outputPath.replace(arrayIndexRegex, '')
  const pathParts = cleanPath.split('.').filter(Boolean)

  const filePropertyTypes: Record<string, string> = {
    url: 'string',
    name: 'string',
    size: 'number',
    type: 'string',
    key: 'string',
    uploadedAt: 'string',
    expiresAt: 'string',
  }

  const lastPart = pathParts[pathParts.length - 1]
  if (lastPart && filePropertyTypes[lastPart]) {
    const parentPath = pathParts.slice(0, -1).join('.')
    let current: any = outputs
    for (const part of pathParts.slice(0, -1)) {
      if (!current || typeof current !== 'object') break
      current = current[part]
    }
    if (current && typeof current === 'object' && 'type' in current && current.type === 'files') {
      return filePropertyTypes[lastPart]
    }
  }

  let current: any = outputs

  for (const part of pathParts) {
    if (!current || typeof current !== 'object') {
      return 'any'
    }
    current = current[part]
  }

  if (!current) return 'any'

  if (typeof current === 'object' && 'type' in current) {
    return current.type
  }

  return typeof current === 'string' ? current : 'any'
}
