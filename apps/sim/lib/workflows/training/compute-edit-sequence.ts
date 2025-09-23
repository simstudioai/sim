import type { WorkflowState } from '@/stores/workflows/workflow/types'

export interface EditOperation {
  operation_type: 'add' | 'edit' | 'delete'
  block_id: string
  params?: {
    type?: string
    name?: string
    inputs?: Record<string, any>
    connections?: Record<string, any>
    removeEdges?: Array<{ targetBlockId: string; sourceHandle?: string }>
  }
}

export interface WorkflowDiff {
  operations: EditOperation[]
  summary: {
    blocksAdded: number
    blocksModified: number
    blocksDeleted: number
    edgesChanged: number
  }
}

/**
 * Compute the edit sequence (operations) needed to transform startState into endState
 * This analyzes the differences and generates operations that can recreate the changes
 */
export function computeEditSequence(
  startState: WorkflowState,
  endState: WorkflowState
): WorkflowDiff {
  const operations: EditOperation[] = []

  const startBlocks = startState.blocks || {}
  const endBlocks = endState.blocks || {}
  const startEdges = startState.edges || []
  const endEdges = endState.edges || []

  // Track statistics
  let blocksAdded = 0
  let blocksModified = 0
  let blocksDeleted = 0
  let edgesChanged = 0

  // 1. Find deleted blocks (exist in start but not in end)
  for (const blockId in startBlocks) {
    if (!(blockId in endBlocks)) {
      operations.push({
        operation_type: 'delete',
        block_id: blockId,
      })
      blocksDeleted++
    }
  }

  // 2. Find added blocks (exist in end but not in start)
  for (const blockId in endBlocks) {
    if (!(blockId in startBlocks)) {
      const block = endBlocks[blockId]
      operations.push({
        operation_type: 'add',
        block_id: blockId,
        params: {
          type: block.type,
          name: block.name,
          inputs: extractInputValues(block),
          connections: extractConnections(blockId, endEdges),
        },
      })
      blocksAdded++
    }
  }

  // 3. Find modified blocks (exist in both but have changes)
  for (const blockId in endBlocks) {
    if (blockId in startBlocks) {
      const startBlock = startBlocks[blockId]
      const endBlock = endBlocks[blockId]
      const changes = computeBlockChanges(startBlock, endBlock, blockId, startEdges, endEdges)

      if (changes) {
        operations.push({
          operation_type: 'edit',
          block_id: blockId,
          params: changes,
        })
        blocksModified++
        if (changes.connections || changes.removeEdges) {
          edgesChanged++
        }
      }
    }
  }

  return {
    operations,
    summary: {
      blocksAdded,
      blocksModified,
      blocksDeleted,
      edgesChanged,
    },
  }
}

/**
 * Extract input values from a block's subBlocks
 */
function extractInputValues(block: any): Record<string, any> {
  const inputs: Record<string, any> = {}

  if (block.subBlocks) {
    for (const [subBlockId, subBlock] of Object.entries(block.subBlocks)) {
      if ((subBlock as any).value !== undefined && (subBlock as any).value !== null) {
        inputs[subBlockId] = (subBlock as any).value
      }
    }
  }

  return inputs
}

/**
 * Extract connections for a specific block from edges
 */
function extractConnections(
  blockId: string,
  edges: Array<{
    source: string
    target: string
    sourceHandle?: string | null
    targetHandle?: string | null
  }>
): Record<string, any> {
  const connections: Record<string, any> = {}

  // Find all edges where this block is the source
  const outgoingEdges = edges.filter((edge) => edge.source === blockId)

  for (const edge of outgoingEdges) {
    const handle = edge.sourceHandle || 'default'

    // Group by source handle
    if (!connections[handle]) {
      connections[handle] = []
    }

    // Add target block to this handle's connections
    if (edge.targetHandle && edge.targetHandle !== 'target') {
      connections[handle].push({
        block: edge.target,
        handle: edge.targetHandle,
      })
    } else {
      connections[handle].push(edge.target)
    }
  }

  // Simplify single-element arrays to just the element
  for (const handle in connections) {
    if (Array.isArray(connections[handle]) && connections[handle].length === 1) {
      connections[handle] = connections[handle][0]
    }
  }

  return connections
}

/**
 * Compute what changed in a block between two states
 */
function computeBlockChanges(
  startBlock: any,
  endBlock: any,
  blockId: string,
  startEdges: Array<{
    source: string
    target: string
    sourceHandle?: string | null
    targetHandle?: string | null
  }>,
  endEdges: Array<{
    source: string
    target: string
    sourceHandle?: string | null
    targetHandle?: string | null
  }>
): Record<string, any> | null {
  const changes: Record<string, any> = {}
  let hasChanges = false

  // Check type change
  if (startBlock.type !== endBlock.type) {
    changes.type = endBlock.type
    hasChanges = true
  }

  // Check name change
  if (startBlock.name !== endBlock.name) {
    changes.name = endBlock.name
    hasChanges = true
  }

  // Check input value changes
  const startInputs = extractInputValues(startBlock)
  const endInputs = extractInputValues(endBlock)

  if (JSON.stringify(startInputs) !== JSON.stringify(endInputs)) {
    changes.inputs = endInputs
    hasChanges = true
  }

  // Check connection changes
  const startConnections = extractConnections(blockId, startEdges)
  const endConnections = extractConnections(blockId, endEdges)

  if (JSON.stringify(startConnections) !== JSON.stringify(endConnections)) {
    // Compute which edges were removed
    const removedEdges: Array<{ targetBlockId: string; sourceHandle?: string }> = []

    for (const handle in startConnections) {
      const startTargets = Array.isArray(startConnections[handle])
        ? startConnections[handle]
        : [startConnections[handle]]
      const endTargets = endConnections[handle]
        ? Array.isArray(endConnections[handle])
          ? endConnections[handle]
          : [endConnections[handle]]
        : []

      for (const target of startTargets) {
        const targetId = typeof target === 'object' ? target.block : target
        const isPresent = endTargets.some(
          (t: any) => (typeof t === 'object' ? t.block : t) === targetId
        )

        if (!isPresent) {
          removedEdges.push({
            targetBlockId: targetId,
            sourceHandle: handle !== 'default' ? handle : undefined,
          })
        }
      }
    }

    if (removedEdges.length > 0) {
      changes.removeEdges = removedEdges
    }

    // Add new connections
    if (Object.keys(endConnections).length > 0) {
      changes.connections = endConnections
    }

    hasChanges = true
  }

  return hasChanges ? changes : null
}

/**
 * Format edit operations into a human-readable description
 */
export function formatEditSequence(operations: EditOperation[]): string[] {
  return operations.map((op) => {
    switch (op.operation_type) {
      case 'add':
        return `Add block "${op.params?.name || op.block_id}" (${op.params?.type || 'unknown'})`
      case 'delete':
        return `Delete block "${op.block_id}"`
      case 'edit': {
        const changes: string[] = []
        if (op.params?.type) changes.push(`type to ${op.params.type}`)
        if (op.params?.name) changes.push(`name to "${op.params.name}"`)
        if (op.params?.inputs) changes.push('inputs')
        if (op.params?.connections) changes.push('connections')
        if (op.params?.removeEdges) changes.push(`remove ${op.params.removeEdges.length} edge(s)`)
        return `Edit block "${op.block_id}": ${changes.join(', ')}`
      }
      default:
        return `Unknown operation on block "${op.block_id}"`
    }
  })
}
