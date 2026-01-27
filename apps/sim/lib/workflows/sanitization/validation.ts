import { createLogger } from '@sim/logger'
import { getBlock } from '@/blocks/registry'
import { isCustomTool, isMcpTool } from '@/executor/constants'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'
import { getTool } from '@/tools/utils'

const logger = createLogger('WorkflowValidation')

/** Tool structure for validation */
interface AgentTool {
  type: string
  customToolId?: string
  schema?: {
    type?: string
    function?: {
      name?: string
      parameters?: {
        type?: string
        properties?: Record<string, unknown>
      }
    }
  }
  code?: string
  usageControl?: string
  [key: string]: unknown
}

/**
 * Checks if a custom tool has a valid inline schema
 */
function isValidCustomToolSchema(tool: unknown): boolean {
  try {
    if (!tool || typeof tool !== 'object') return false
    const t = tool as AgentTool
    if (t.type !== 'custom-tool') return true // non-custom tools are validated elsewhere

    const schema = t.schema
    if (!schema || typeof schema !== 'object') return false
    const fn = schema.function
    if (!fn || typeof fn !== 'object') return false
    if (!fn.name || typeof fn.name !== 'string') return false

    const params = fn.parameters
    if (!params || typeof params !== 'object') return false
    if (params.type !== 'object') return false
    if (!params.properties || typeof params.properties !== 'object') return false

    return true
  } catch (_err) {
    return false
  }
}

/**
 * Checks if a custom tool is a valid reference-only format (new format)
 */
function isValidCustomToolReference(tool: unknown): boolean {
  try {
    if (!tool || typeof tool !== 'object') return false
    const t = tool as AgentTool
    if (t.type !== 'custom-tool') return false

    // Reference format: has customToolId but no inline schema/code
    // This is valid - the tool will be loaded dynamically during execution
    if (t.customToolId && typeof t.customToolId === 'string') {
      return true
    }

    return false
  } catch (_err) {
    return false
  }
}

export function sanitizeAgentToolsInBlocks(blocks: Record<string, BlockState>): {
  blocks: Record<string, BlockState>
  warnings: string[]
} {
  const warnings: string[] = []

  // Shallow clone to avoid mutating callers
  const sanitizedBlocks: Record<string, BlockState> = { ...blocks }

  for (const [blockId, block] of Object.entries(sanitizedBlocks)) {
    try {
      if (!block || block.type !== 'agent') continue
      const subBlocks = block.subBlocks || {}
      const toolsSubBlock = subBlocks.tools
      if (!toolsSubBlock) continue

      let value = toolsSubBlock.value

      // Parse legacy string format
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value)
        } catch (_e) {
          warnings.push(
            `Block ${block.name || blockId}: invalid tools JSON; resetting tools to empty array`
          )
          value = []
        }
      }

      if (!Array.isArray(value)) {
        // Force to array to keep client safe
        warnings.push(`Block ${block.name || blockId}: tools value is not an array; resetting`)
        toolsSubBlock.value = []
        continue
      }

      const originalLength = value.length
      const cleaned = value
        .filter((tool: unknown) => {
          // Allow non-custom tools to pass through as-is
          if (!tool || typeof tool !== 'object') return false
          const t = tool as AgentTool
          if (t.type !== 'custom-tool') return true

          // Check if it's a valid reference-only format (new format)
          if (isValidCustomToolReference(tool)) {
            return true
          }

          // Check if it's a valid inline schema format (legacy format)
          const ok = isValidCustomToolSchema(tool)
          if (!ok) {
            logger.warn('Removing invalid custom tool from workflow', {
              blockId,
              blockName: block.name,
              hasCustomToolId: !!t.customToolId,
              hasSchema: !!t.schema,
            })
          }
          return ok
        })
        .map((tool: unknown) => {
          const t = tool as AgentTool
          if (t.type === 'custom-tool') {
            // For reference-only tools, ensure usageControl default
            if (!t.usageControl) {
              t.usageControl = 'auto'
            }
            // For inline tools (legacy), also ensure code default
            if (!t.customToolId && (!t.code || typeof t.code !== 'string')) {
              t.code = ''
            }
          }
          return tool
        })

      if (cleaned.length !== originalLength) {
        warnings.push(
          `Block ${block.name || blockId}: removed ${originalLength - cleaned.length} invalid tool(s)`
        )
      }

      // Cast cleaned to the expected SubBlockState value type
      // The value is a tools array but SubBlockState.value is typed narrowly
      toolsSubBlock.value = cleaned as unknown as typeof toolsSubBlock.value
      // Reassign in case caller uses object identity
      sanitizedBlocks[blockId] = { ...block, subBlocks: { ...subBlocks, tools: toolsSubBlock } }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      warnings.push(`Block ${block?.name || blockId}: tools sanitation failed: ${message}`)
    }
  }

  return { blocks: sanitizedBlocks, warnings }
}

export interface WorkflowValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  sanitizedState?: WorkflowState
}

/**
 * Comprehensive workflow state validation
 * Checks all tool references, block types, and required fields
 */
export function validateWorkflowState(
  workflowState: WorkflowState,
  options: { sanitize?: boolean } = {}
): WorkflowValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  let sanitizedState = workflowState

  try {
    // Basic structure validation
    if (!workflowState || typeof workflowState !== 'object') {
      errors.push('Invalid workflow state: must be an object')
      return { valid: false, errors, warnings }
    }

    if (!workflowState.blocks || typeof workflowState.blocks !== 'object') {
      errors.push('Invalid workflow state: missing blocks')
      return { valid: false, errors, warnings }
    }

    // Validate each block
    const sanitizedBlocks: Record<string, BlockState> = {}
    let hasChanges = false

    for (const [blockId, block] of Object.entries(workflowState.blocks)) {
      if (!block || typeof block !== 'object') {
        errors.push(`Block ${blockId}: invalid block structure`)
        continue
      }

      // Check if block type exists
      const blockConfig = getBlock(block.type)

      // Special handling for container blocks (loop and parallel)
      if (block.type === 'loop' || block.type === 'parallel') {
        // These are valid container types, they don't need block configs
        sanitizedBlocks[blockId] = block
        continue
      }

      if (!blockConfig) {
        errors.push(`Block ${block.name || blockId}: unknown block type '${block.type}'`)
        if (options.sanitize) {
          hasChanges = true
          continue // Skip this block in sanitized output
        }
      }

      // Validate tool references in blocks that use tools
      if (block.type === 'api' || block.type === 'generic') {
        // For API and generic blocks, the tool is determined by the block's tool configuration
        // In the workflow state, we need to check if the block type has valid tool access
        const blockConfig = getBlock(block.type)
        if (blockConfig?.tools?.access) {
          // API block has static tool access
          const toolIds = blockConfig.tools.access
          for (const toolId of toolIds) {
            const validationError = validateToolReference(toolId, block.type, block.name)
            if (validationError) {
              errors.push(validationError)
            }
          }
        }
      } else if (block.type === 'knowledge' || block.type === 'supabase' || block.type === 'mcp') {
        // These blocks have dynamic tool selection based on operation
        // The actual tool validation happens at runtime based on the operation value
        // For now, just ensure the block type is valid (already checked above)
      }

      // Special validation for agent blocks
      if (block.type === 'agent' && block.subBlocks?.tools?.value) {
        const toolsSanitization = sanitizeAgentToolsInBlocks({ [blockId]: block })
        warnings.push(...toolsSanitization.warnings)
        if (toolsSanitization.warnings.length > 0) {
          sanitizedBlocks[blockId] = toolsSanitization.blocks[blockId]
          hasChanges = true
        } else {
          sanitizedBlocks[blockId] = block
        }
      } else {
        sanitizedBlocks[blockId] = block
      }
    }

    // Validate edges reference existing blocks
    if (workflowState.edges && Array.isArray(workflowState.edges)) {
      const blockIds = new Set(Object.keys(sanitizedBlocks))
      const loopIds = new Set(Object.keys(workflowState.loops || {}))
      const parallelIds = new Set(Object.keys(workflowState.parallels || {}))

      for (const edge of workflowState.edges) {
        if (!edge || typeof edge !== 'object') {
          errors.push('Invalid edge structure')
          continue
        }

        // Check if source and target exist
        const sourceExists =
          blockIds.has(edge.source) || loopIds.has(edge.source) || parallelIds.has(edge.source)
        const targetExists =
          blockIds.has(edge.target) || loopIds.has(edge.target) || parallelIds.has(edge.target)

        if (!sourceExists) {
          errors.push(`Edge references non-existent source block '${edge.source}'`)
        }
        if (!targetExists) {
          errors.push(`Edge references non-existent target block '${edge.target}'`)
        }
      }
    }

    // If we made changes during sanitization, create a new state object
    if (hasChanges && options.sanitize) {
      sanitizedState = {
        ...workflowState,
        blocks: sanitizedBlocks,
      }
    }

    const valid = errors.length === 0
    return {
      valid,
      errors,
      warnings,
      sanitizedState: options.sanitize ? sanitizedState : undefined,
    }
  } catch (err) {
    logger.error('Workflow validation failed with exception', err)
    errors.push(`Validation failed: ${err instanceof Error ? err.message : String(err)}`)
    return { valid: false, errors, warnings }
  }
}

/**
 * Validate tool reference for a specific block
 * Returns null if valid, error message if invalid
 */
export function validateToolReference(
  toolId: string | undefined,
  blockType: string,
  blockName?: string
): string | null {
  if (!toolId) return null

  if (!isCustomTool(toolId) && !isMcpTool(toolId)) {
    // For built-in tools, verify they exist
    const tool = getTool(toolId)
    if (!tool) {
      return `Block ${blockName || 'unknown'} (${blockType}): references non-existent tool '${toolId}'`
    }
  }

  return null
}
