import type { Edge } from 'reactflow'
import type {
  BlockState,
  Loop,
  Parallel,
  Position,
  WorkflowState,
} from '@/stores/workflows/workflow/types'

/**
 * Sanitized workflow state for copilot (removes all UI-specific data)
 */
export interface CopilotWorkflowState {
  blocks: Record<string, CopilotBlockState>
  edges: CopilotEdge[]
  loops: Record<string, Loop>
  parallels: Record<string, Parallel>
}

/**
 * Block state for copilot (no positions, no UI dimensions)
 */
export interface CopilotBlockState {
  id: string
  type: string
  name: string
  subBlocks: BlockState['subBlocks']
  outputs: BlockState['outputs']
  enabled: boolean
  advancedMode?: boolean
  triggerMode?: boolean
  // Keep semantic data only (no width/height)
  data?: {
    parentId?: string
    extent?: 'parent'
    loopType?: 'for' | 'forEach'
    parallelType?: 'collection' | 'count'
    collection?: any
    count?: number
  }
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
 * Sanitize workflow state for copilot by removing all UI-specific data
 * Copilot doesn't need to see positions, dimensions, or visual styling
 */
export function sanitizeForCopilot(state: WorkflowState): CopilotWorkflowState {
  const sanitizedBlocks: Record<string, CopilotBlockState> = {}

  // Sanitize blocks - remove position and UI-only fields
  Object.entries(state.blocks).forEach(([blockId, block]) => {
    const sanitizedData: CopilotBlockState['data'] = block.data
      ? {
          // Keep semantic fields only
          ...(block.data.parentId !== undefined && { parentId: block.data.parentId }),
          ...(block.data.extent !== undefined && { extent: block.data.extent }),
          ...(block.data.loopType !== undefined && { loopType: block.data.loopType }),
          ...(block.data.parallelType !== undefined && { parallelType: block.data.parallelType }),
          ...(block.data.collection !== undefined && { collection: block.data.collection }),
          ...(block.data.count !== undefined && { count: block.data.count }),
        }
      : undefined

    sanitizedBlocks[blockId] = {
      id: block.id,
      type: block.type,
      name: block.name,
      subBlocks: block.subBlocks,
      outputs: block.outputs,
      enabled: block.enabled,
      ...(block.advancedMode !== undefined && { advancedMode: block.advancedMode }),
      ...(block.triggerMode !== undefined && { triggerMode: block.triggerMode }),
      ...(sanitizedData && Object.keys(sanitizedData).length > 0 && { data: sanitizedData }),
    }
  })

  // Sanitize edges - keep only semantic connection data
  const sanitizedEdges: CopilotEdge[] = state.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.sourceHandle !== undefined &&
      edge.sourceHandle !== null && { sourceHandle: edge.sourceHandle }),
    ...(edge.targetHandle !== undefined &&
      edge.targetHandle !== null && { targetHandle: edge.targetHandle }),
  }))

  return {
    blocks: sanitizedBlocks,
    edges: sanitizedEdges,
    loops: state.loops || {},
    parallels: state.parallels || {},
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

/**
 * Validate that edges reference existing blocks
 */
export function validateEdges(
  blocks: Record<string, any>,
  edges: CopilotEdge[]
): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []
  const blockIds = new Set(Object.keys(blocks))

  edges.forEach((edge, index) => {
    if (!blockIds.has(edge.source)) {
      errors.push(`Edge ${index} references non-existent source block: ${edge.source}`)
    }
    if (!blockIds.has(edge.target)) {
      errors.push(`Edge ${index} references non-existent target block: ${edge.target}`)
    }
  })

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Generate position for a new block based on its connections
 * Uses compact horizontal spacing and intelligent positioning
 */
export function generatePositionForNewBlock(
  blockId: string,
  edges: CopilotEdge[],
  existingBlocks: Record<string, BlockState>
): Position {
  const HORIZONTAL_SPACING = 550
  const VERTICAL_SPACING = 200

  const incomingEdges = edges.filter((e) => e.target === blockId)

  if (incomingEdges.length > 0) {
    const sourceBlocks = incomingEdges
      .map((e) => existingBlocks[e.source])
      .filter((b) => b !== undefined)

    if (sourceBlocks.length > 0) {
      const rightmostX = Math.max(...sourceBlocks.map((b) => b.position.x))
      const avgY = sourceBlocks.reduce((sum, b) => sum + b.position.y, 0) / sourceBlocks.length

      return {
        x: rightmostX + HORIZONTAL_SPACING,
        y: avgY,
      }
    }
  }

  const outgoingEdges = edges.filter((e) => e.source === blockId)

  if (outgoingEdges.length > 0) {
    const targetBlocks = outgoingEdges
      .map((e) => existingBlocks[e.target])
      .filter((b) => b !== undefined)

    if (targetBlocks.length > 0) {
      const leftmostX = Math.min(...targetBlocks.map((b) => b.position.x))
      const avgY = targetBlocks.reduce((sum, b) => sum + b.position.y, 0) / targetBlocks.length

      return {
        x: Math.max(150, leftmostX - HORIZONTAL_SPACING),
        y: avgY,
      }
    }
  }

  const existingPositions = Object.values(existingBlocks).map((b) => b.position)
  if (existingPositions.length > 0) {
    const maxY = Math.max(...existingPositions.map((p) => p.y))
    return {
      x: 150,
      y: maxY + VERTICAL_SPACING,
    }
  }

  return { x: 150, y: 300 }
}

/**
 * Merge sanitized copilot state with full UI state
 * Preserves positions for existing blocks, generates positions for new blocks
 */
export function mergeWithUIState(
  sanitized: CopilotWorkflowState,
  fullState: WorkflowState
): WorkflowState {
  const mergedBlocks: Record<string, BlockState> = {}
  const existingBlocks = fullState.blocks

  // Convert sanitized edges to full edges for position generation
  const sanitizedEdges = sanitized.edges

  // Process each block from sanitized state
  Object.entries(sanitized.blocks).forEach(([blockId, sanitizedBlock]) => {
    const existingBlock = existingBlocks[blockId]

    if (existingBlock) {
      // Existing block - preserve position and UI fields, update semantic fields
      mergedBlocks[blockId] = {
        ...existingBlock,
        // Update semantic fields from sanitized
        type: sanitizedBlock.type,
        name: sanitizedBlock.name,
        subBlocks: sanitizedBlock.subBlocks,
        outputs: sanitizedBlock.outputs,
        enabled: sanitizedBlock.enabled,
        advancedMode: sanitizedBlock.advancedMode,
        triggerMode: sanitizedBlock.triggerMode,
        // Merge data carefully
        data: sanitizedBlock.data
          ? {
              ...existingBlock.data,
              ...sanitizedBlock.data,
            }
          : existingBlock.data,
      }
    } else {
      // New block - generate position
      const position = generatePositionForNewBlock(blockId, sanitizedEdges, existingBlocks)

      mergedBlocks[blockId] = {
        id: sanitizedBlock.id,
        type: sanitizedBlock.type,
        name: sanitizedBlock.name,
        position,
        subBlocks: sanitizedBlock.subBlocks,
        outputs: sanitizedBlock.outputs,
        enabled: sanitizedBlock.enabled,
        horizontalHandles: true,
        isWide: false,
        height: 0,
        advancedMode: sanitizedBlock.advancedMode,
        triggerMode: sanitizedBlock.triggerMode,
        data: sanitizedBlock.data
          ? {
              ...sanitizedBlock.data,
              // Add UI dimensions if it's a container
              ...(sanitizedBlock.type === 'loop' || sanitizedBlock.type === 'parallel'
                ? {
                    width: 500,
                    height: 300,
                    type: 'subflowNode',
                  }
                : {}),
            }
          : undefined,
      }
    }
  })

  // Convert sanitized edges to full edges
  const mergedEdges: Edge[] = sanitized.edges.map((edge) => {
    // Try to find existing edge to preserve styling
    const existingEdge = fullState.edges.find(
      (e) =>
        e.source === edge.source &&
        e.target === edge.target &&
        e.sourceHandle === edge.sourceHandle &&
        e.targetHandle === edge.targetHandle
    )

    if (existingEdge) {
      return existingEdge
    }

    // New edge - create with defaults
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      type: 'default',
      data: {},
    } as Edge
  })

  return {
    blocks: mergedBlocks,
    edges: mergedEdges,
    loops: sanitized.loops,
    parallels: sanitized.parallels,
    lastSaved: Date.now(),
    // Preserve deployment info
    isDeployed: fullState.isDeployed,
    deployedAt: fullState.deployedAt,
    deploymentStatuses: fullState.deploymentStatuses,
    hasActiveWebhook: fullState.hasActiveWebhook,
  }
}
