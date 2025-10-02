import type { Edge } from 'reactflow'
import type { BlockState, Loop, Parallel, WorkflowState } from '@/stores/workflows/workflow/types'

/**
 * Sanitized workflow state for copilot (removes all UI-specific data)
 * Connections are embedded in blocks for consistency with operations format
 * Loops and parallels use nested structure - no separate loops/parallels objects
 */
export interface CopilotWorkflowState {
  blocks: Record<string, CopilotBlockState>
}

/**
 * Block state for copilot (no positions, no UI dimensions, no redundant IDs)
 * Connections are embedded here instead of separate edges array
 * Loops and parallels have nested structure for clarity
 */
export interface CopilotBlockState {
  type: string
  name: string
  inputs?: Record<string, string | number | string[][]>
  outputs: BlockState['outputs']
  connections?: Record<string, string | string[]>
  nestedNodes?: Record<string, CopilotBlockState>
  enabled: boolean
  advancedMode?: boolean
  triggerMode?: boolean
}

/**
 * Edge state for copilot (only semantic connection data)
 */
export interface CopilotEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

/**
 * Export workflow state (includes positions but removes secrets)
 */
export interface ExportWorkflowState {
  version: string
  exportedAt: string
  state: {
    blocks: Record<string, BlockState>
    edges: Edge[]
    loops: Record<string, Loop>
    parallels: Record<string, Parallel>
  }
}

/**
 * Check if a subblock contains sensitive/secret data
 */
function isSensitiveSubBlock(key: string, subBlock: BlockState['subBlocks'][string]): boolean {
  // Check if it's an OAuth input type
  if (subBlock.type === 'oauth-input') {
    return true
  }

  // Check if the field name suggests it contains sensitive data
  const sensitivePattern = /credential|oauth|api[_-]?key|token|secret|auth|password|bearer/i
  if (sensitivePattern.test(key)) {
    return true
  }

  // Check if the value itself looks like a secret (but not environment variable references)
  if (typeof subBlock.value === 'string' && subBlock.value.length > 0) {
    // Don't sanitize environment variable references like {{VAR_NAME}}
    if (subBlock.value.startsWith('{{') && subBlock.value.endsWith('}}')) {
      return false
    }

    // If it matches sensitive patterns in the value, it's likely a hardcoded secret
    if (sensitivePattern.test(subBlock.value)) {
      return true
    }
  }

  return false
}

/**
 * Sanitize subblocks by removing null values, secrets, and simplifying structure
 * Maps each subblock key directly to its value instead of the full object
 */
function sanitizeSubBlocks(
  subBlocks: BlockState['subBlocks']
): Record<string, string | number | string[][]> {
  const sanitized: Record<string, string | number | string[][]> = {}

  Object.entries(subBlocks).forEach(([key, subBlock]) => {
    // Skip null/undefined values
    if (subBlock.value === null || subBlock.value === undefined) {
      return
    }

    // For sensitive fields, either omit or replace with placeholder
    if (isSensitiveSubBlock(key, subBlock)) {
      // If it's an environment variable reference, keep it
      if (
        typeof subBlock.value === 'string' &&
        subBlock.value.startsWith('{{') &&
        subBlock.value.endsWith('}}')
      ) {
        sanitized[key] = subBlock.value
      }
      // Otherwise omit the sensitive value entirely
      return
    }

    // For non-sensitive, non-null values, include them
    sanitized[key] = subBlock.value
  })

  return sanitized
}

/**
 * Reconstruct full subBlock structure from simplified copilot format
 * Uses existing block structure as template for id and type fields
 */
function reconstructSubBlocks(
  simplifiedSubBlocks: Record<string, string | number | string[][]>,
  existingSubBlocks?: BlockState['subBlocks']
): BlockState['subBlocks'] {
  const reconstructed: BlockState['subBlocks'] = {}

  Object.entries(simplifiedSubBlocks).forEach(([key, value]) => {
    const existingSubBlock = existingSubBlocks?.[key]

    reconstructed[key] = {
      id: existingSubBlock?.id || key,
      type: existingSubBlock?.type || 'short-input',
      value,
    }
  })

  return reconstructed
}

/**
 * Extract connections for a block from edges and format as operations-style connections
 */
function extractConnectionsForBlock(
  blockId: string,
  edges: WorkflowState['edges']
): Record<string, string | string[]> | undefined {
  const connections: Record<string, string[]> = {}

  // Find all outgoing edges from this block
  const outgoingEdges = edges.filter((edge) => edge.source === blockId)

  if (outgoingEdges.length === 0) {
    return undefined
  }

  // Group by source handle
  for (const edge of outgoingEdges) {
    const handle = edge.sourceHandle || 'source'

    if (!connections[handle]) {
      connections[handle] = []
    }

    connections[handle].push(edge.target)
  }

  // Simplify single-element arrays to just the string
  const simplified: Record<string, string | string[]> = {}
  for (const [handle, targets] of Object.entries(connections)) {
    simplified[handle] = targets.length === 1 ? targets[0] : targets
  }

  return simplified
}

/**
 * Sanitize workflow state for copilot by removing all UI-specific data
 * Creates nested structure for loops/parallels with their child blocks inside
 */
export function sanitizeForCopilot(state: WorkflowState): CopilotWorkflowState {
  const sanitizedBlocks: Record<string, CopilotBlockState> = {}
  const processedBlocks = new Set<string>()

  // Helper to find child blocks of a parent (loop/parallel container)
  const findChildBlocks = (parentId: string): string[] => {
    return Object.keys(state.blocks).filter(
      (blockId) => state.blocks[blockId].data?.parentId === parentId
    )
  }

  // Helper to recursively sanitize a block and its children
  const sanitizeBlock = (blockId: string, block: BlockState): CopilotBlockState => {
    const connections = extractConnectionsForBlock(blockId, state.edges)

    // For loop/parallel blocks, extract config from block.data instead of subBlocks
    let inputs: Record<string, string | number | string[][]> = {}

    if (block.type === 'loop' || block.type === 'parallel') {
      // Extract configuration from block.data
      if (block.data?.loopType) inputs.loopType = block.data.loopType
      if (block.data?.count !== undefined) inputs.iterations = block.data.count
      if (block.data?.collection !== undefined) inputs.collection = block.data.collection
      if (block.data?.parallelType) inputs.parallelType = block.data.parallelType
    } else {
      // For regular blocks, sanitize subBlocks
      inputs = sanitizeSubBlocks(block.subBlocks)
    }

    // Check if this is a loop or parallel (has children)
    const childBlockIds = findChildBlocks(blockId)
    const nestedNodes: Record<string, CopilotBlockState> = {}

    if (childBlockIds.length > 0) {
      // Recursively sanitize child blocks
      childBlockIds.forEach((childId) => {
        const childBlock = state.blocks[childId]
        if (childBlock) {
          nestedNodes[childId] = sanitizeBlock(childId, childBlock)
          processedBlocks.add(childId)
        }
      })
    }

    const result: CopilotBlockState = {
      type: block.type,
      name: block.name,
      outputs: block.outputs,
      enabled: block.enabled,
    }

    if (Object.keys(inputs).length > 0) result.inputs = inputs
    if (connections) result.connections = connections
    if (Object.keys(nestedNodes).length > 0) result.nestedNodes = nestedNodes
    if (block.advancedMode !== undefined) result.advancedMode = block.advancedMode
    if (block.triggerMode !== undefined) result.triggerMode = block.triggerMode

    return result
  }

  // Process only root-level blocks (those without a parent)
  Object.entries(state.blocks).forEach(([blockId, block]) => {
    // Skip if already processed as a child
    if (processedBlocks.has(blockId)) return

    // Skip if it has a parent (it will be processed as nested)
    if (block.data?.parentId) return

    sanitizedBlocks[blockId] = sanitizeBlock(blockId, block)
  })

  return {
    blocks: sanitizedBlocks,
  }
}

/**
 * Sanitize workflow state for export by removing secrets but keeping positions
 * Users need positions to restore the visual layout when importing
 */
export function sanitizeForExport(state: WorkflowState): ExportWorkflowState {
  // Deep clone to avoid mutating original state
  const clonedState = JSON.parse(
    JSON.stringify({
      blocks: state.blocks,
      edges: state.edges,
      loops: state.loops || {},
      parallels: state.parallels || {},
    })
  )

  // Remove sensitive data from subblocks
  Object.values(clonedState.blocks).forEach((block: any) => {
    if (block.subBlocks) {
      Object.entries(block.subBlocks).forEach(([key, subBlock]: [string, any]) => {
        // Clear OAuth credentials and API keys using regex patterns
        if (
          /credential|oauth|api[_-]?key|token|secret|auth|password|bearer/i.test(key) ||
          /credential|oauth|api[_-]?key|token|secret|auth|password|bearer/i.test(
            subBlock.type || ''
          ) ||
          (typeof subBlock.value === 'string' &&
            /credential|oauth|api[_-]?key|token|secret|auth|password|bearer/i.test(subBlock.value))
        ) {
          subBlock.value = ''
        }
      })
    }

    // Also clear from data field if present
    if (block.data) {
      Object.entries(block.data).forEach(([key, value]: [string, any]) => {
        if (/credential|oauth|api[_-]?key|token|secret|auth|password|bearer/i.test(key)) {
          block.data[key] = ''
        }
      })
    }
  })

  return {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    state: clonedState,
  }
}
