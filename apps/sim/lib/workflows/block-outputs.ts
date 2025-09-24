import { getBlock } from '@/blocks'
import type { BlockConfig } from '@/blocks/types'

/**
 * Get the effective outputs for a block, including dynamic outputs from inputFormat
 */
export function getBlockOutputs(
  blockType: string,
  subBlocks?: Record<string, any>
): Record<string, any> {
  const blockConfig = getBlock(blockType)
  if (!blockConfig) return {}

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
        files: { type: 'array', description: 'Uploaded files' },
      }
    }
    if (
      startWorkflowValue === 'api' ||
      startWorkflowValue === 'run' ||
      startWorkflowValue === 'manual'
    ) {
      // API/manual mode - use inputFormat fields only
      const inputFormatValue = subBlocks?.inputFormat?.value
      outputs = {}

      if (Array.isArray(inputFormatValue)) {
        inputFormatValue.forEach((field: { name?: string; type?: string }) => {
          if (field.name && field.name.trim() !== '') {
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

  if (blockType === 'form_trigger') {
    outputs = {}
    const formConfigValue = subBlocks?.formConfig?.value || subBlocks?.formConfig
    const fields = formConfigValue?.fields
    if (Array.isArray(fields)) {
      const sanitizeKey = (val: string | undefined): string => {
        const s = (val || '').toString().trim()
        if (!s) return ''
        return s
          .replace(/[^a-zA-Z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '')
          .toLowerCase()
      }

      for (const field of fields) {
        const keyFromLabel = sanitizeKey(field?.label)
        const keyFromName = sanitizeKey(field?.name)
        const key = keyFromName || keyFromLabel
        if (!key) continue

        const type = (() => {
          const t = (field?.type || '').toString()
          if (t === 'number') return 'number'
          if (t === 'checkbox') return 'boolean'
          return 'string'
        })()

        outputs[key] = { type: type as any, description: 'Field from form configuration' }
      }
    }
  }

  if (hasInputFormat(blockConfig) && subBlocks?.inputFormat?.value) {
    const inputFormatValue = subBlocks.inputFormat.value

    if (Array.isArray(inputFormatValue)) {
      if (blockType === 'api_trigger' || blockType === 'input_trigger') {
        outputs = {}

        inputFormatValue.forEach((field: { name?: string; type?: string }) => {
          if (field.name && field.name.trim() !== '') {
            outputs[field.name] = {
              type: (field.type || 'any') as any,
              description: `Field from input format`,
            }
          }
        })
      }
    } else if (blockType === 'api_trigger' || blockType === 'input_trigger') {
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
export function getBlockOutputPaths(blockType: string, subBlocks?: Record<string, any>): string[] {
  const outputs = getBlockOutputs(blockType, subBlocks)
  return Object.keys(outputs)
}

/**
 * Get the type of a specific output path
 */
export function getBlockOutputType(
  blockType: string,
  outputPath: string,
  subBlocks?: Record<string, any>
): string {
  const outputs = getBlockOutputs(blockType, subBlocks)
  const output = outputs[outputPath]

  if (!output) return 'any'

  if (typeof output === 'object' && 'type' in output) {
    return output.type
  }

  return typeof output === 'string' ? output : 'any'
}
