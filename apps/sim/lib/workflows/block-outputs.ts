import { getBlock } from '@/blocks'
import type { BlockConfig } from '@/blocks/types'
import { getTrigger } from '@/triggers'

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

  // If block is in trigger mode, use trigger outputs instead of block outputs
  if (triggerMode && blockConfig.triggers?.enabled) {
    const triggerId = subBlocks?.triggerId?.value || blockConfig.triggers?.available?.[0]
    if (triggerId) {
      const trigger = getTrigger(triggerId)
      if (trigger?.outputs) {
        return trigger.outputs
      }
    }
  }

  // Start with the static outputs defined in the config
  let outputs = { ...(blockConfig.outputs || {}) }

  // Special handling for starter block (legacy)
  if (blockType === 'starter') {
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
      let inputFormatValue = subBlocks?.inputFormat?.value
      outputs = {}

      if (
        inputFormatValue !== null &&
        inputFormatValue !== undefined &&
        !Array.isArray(inputFormatValue)
      ) {
        inputFormatValue = []
      }

      if (Array.isArray(inputFormatValue)) {
        inputFormatValue.forEach((field: { name?: string; type?: string }) => {
          if (field?.name && field.name.trim() !== '') {
            outputs[field.name] = {
              type: (field.type || 'any') as any,
              description: `Field from input format`,
            }
          }
        })
      }

      return outputs
    }
  }

  // For blocks with inputFormat, add dynamic outputs
  if (hasInputFormat(blockConfig) && subBlocks?.inputFormat?.value) {
    let inputFormatValue = subBlocks.inputFormat.value

    // Sanitize inputFormat - ensure it's an array
    if (
      inputFormatValue !== null &&
      inputFormatValue !== undefined &&
      !Array.isArray(inputFormatValue)
    ) {
      // Invalid format, default to empty array
      inputFormatValue = []
    }

    if (Array.isArray(inputFormatValue)) {
      // For API and Input triggers, only use inputFormat fields
      if (blockType === 'api_trigger' || blockType === 'input_trigger') {
        outputs = {} // Clear all default outputs

        // Add each field from inputFormat as an output at root level
        inputFormatValue.forEach((field: { name?: string; type?: string }) => {
          if (field?.name && field.name.trim() !== '') {
            outputs[field.name] = {
              type: (field.type || 'any') as any,
              description: `Field from input format`,
            }
          }
        })
      }
    } else if (blockType === 'api_trigger' || blockType === 'input_trigger') {
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
