import type { CopilotWorkflowState } from '@/lib/workflows/json-sanitizer'
import { TRIGGER_RUNTIME_SUBBLOCK_IDS } from '@/triggers/consts'

export interface EditOperation {
  operation_type: 'add' | 'edit' | 'delete' | 'insert_into_subflow' | 'extract_from_subflow'
  block_id: string
  params?: {
    type?: string
    name?: string
    outputs?: Record<string, any>
    enabled?: boolean
    triggerMode?: boolean
    advancedMode?: boolean
    inputs?: Record<string, any>
    connections?: Record<string, any>
    nestedNodes?: Record<string, any>
    subflowId?: string
  }
}

export interface WorkflowDiff {
  operations: EditOperation[]
  summary: {
    blocksAdded: number
    blocksModified: number
    blocksDeleted: number
    edgesChanged: number
    subflowsChanged: number
  }
}

/**
 * Flatten nested blocks into a single-level map for comparison
 * Returns map of blockId -> {block, parentId}
 */
function flattenBlocks(
  blocks: Record<string, any>
): Record<string, { block: any; parentId?: string }> {
  const flattened: Record<string, { block: any; parentId?: string }> = {}

  const processBlock = (blockId: string, block: any, parentId?: string) => {
    flattened[blockId] = { block, parentId }

    // Recursively process nested nodes
    if (block.nestedNodes) {
      Object.entries(block.nestedNodes).forEach(([nestedId, nestedBlock]) => {
        processBlock(nestedId, nestedBlock, blockId)
      })
    }
  }

  Object.entries(blocks).forEach(([blockId, block]) => {
    processBlock(blockId, block)
  })

  return flattened
}

/**
 * Extract all edges from blocks with embedded connections (including nested)
 */
function extractAllEdgesFromBlocks(blocks: Record<string, any>): Array<{
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}> {
  const edges: Array<{
    source: string
    target: string
    sourceHandle?: string | null
    targetHandle?: string | null
  }> = []

  const processBlockConnections = (block: any, blockId: string) => {
    if (block.connections) {
      Object.entries(block.connections).forEach(([sourceHandle, targets]) => {
        const targetArray = Array.isArray(targets) ? targets : [targets]
        targetArray.forEach((target: string) => {
          edges.push({
            source: blockId,
            target,
            sourceHandle,
            targetHandle: 'target',
          })
        })
      })
    }

    // Process nested nodes
    if (block.nestedNodes) {
      Object.entries(block.nestedNodes).forEach(([nestedId, nestedBlock]) => {
        processBlockConnections(nestedBlock, nestedId)
      })
    }
  }

  Object.entries(blocks).forEach(([blockId, block]) => {
    processBlockConnections(block, blockId)
  })

  return edges
}

/**
 * Compute the edit sequence (operations) needed to transform startState into endState
 * This analyzes the differences and generates operations that can recreate the changes
 * Works with sanitized CopilotWorkflowState (no positions, only semantic data)
 */
export function computeEditSequence(
  startState: CopilotWorkflowState,
  endState: CopilotWorkflowState
): WorkflowDiff {
  const operations: EditOperation[] = []

  const startBlocks = startState.blocks || {}
  const endBlocks = endState.blocks || {}

  // Flatten nested blocks for comparison (includes nested nodes at top level)
  const startFlattened = flattenBlocks(startBlocks)
  const endFlattened = flattenBlocks(endBlocks)

  // Extract edges from connections for tracking
  const startEdges = extractAllEdgesFromBlocks(startBlocks)
  const endEdges = extractAllEdgesFromBlocks(endBlocks)

  // Track statistics
  let blocksAdded = 0
  let blocksModified = 0
  let blocksDeleted = 0
  let edgesChanged = 0
  let subflowsChanged = 0

  // Track which blocks are being deleted (including subflows)
  const deletedBlocks = new Set<string>()
  for (const blockId in startFlattened) {
    if (!(blockId in endFlattened)) {
      deletedBlocks.add(blockId)
    }
  }

  // 1. Find deleted blocks (exist in start but not in end)
  for (const blockId in startFlattened) {
    if (!(blockId in endFlattened)) {
      const { parentId } = startFlattened[blockId]

      // Skip if parent is also being deleted (cascade delete is implicit)
      if (parentId && deletedBlocks.has(parentId)) {
        continue
      }

      if (parentId) {
        // Block was inside a subflow and was removed (but subflow still exists)
        operations.push({
          operation_type: 'extract_from_subflow',
          block_id: blockId,
          params: {
            subflowId: parentId,
          },
        })
        subflowsChanged++
      } else {
        // Regular block deletion
        operations.push({
          operation_type: 'delete',
          block_id: blockId,
        })
        blocksDeleted++
      }
    }
  }

  // 2. Find added blocks (exist in end but not in start)
  for (const blockId in endFlattened) {
    if (!(blockId in startFlattened)) {
      const { block, parentId } = endFlattened[blockId]
      if (parentId) {
        // Check if this block will be included in parent's nestedNodes
        const parentData = endFlattened[parentId]
        const parentIsNew = parentData && !(parentId in startFlattened)
        const parentHasNestedNodes = parentData?.block?.nestedNodes?.[blockId]

        // Skip if parent is new and will include this block in nestedNodes
        if (parentIsNew && parentHasNestedNodes) {
          // Parent's 'add' operation will include this child, skip separate operation
          continue
        }

        // Block was added inside a subflow - include full block state
        const addParams: EditOperation['params'] = {
          subflowId: parentId,
          type: block.type,
          name: block.name,
          outputs: block.outputs,
          enabled: block.enabled !== undefined ? block.enabled : true,
        }

        // Only include triggerMode/advancedMode if true
        if (block?.triggerMode === true) {
          addParams.triggerMode = true
        }
        if (block?.advancedMode === true) {
          addParams.advancedMode = true
        }

        // Add inputs if present
        const inputs = extractInputValues(block)
        if (Object.keys(inputs).length > 0) {
          addParams.inputs = inputs
        }

        // Add connections if present
        const connections = extractConnections(blockId, endEdges)
        if (connections && Object.keys(connections).length > 0) {
          addParams.connections = connections
        }

        operations.push({
          operation_type: 'insert_into_subflow',
          block_id: blockId,
          params: addParams,
        })
        subflowsChanged++
      } else {
        // Regular block addition at root level
        const addParams: EditOperation['params'] = {
          type: block.type,
          name: block.name,
        }

        if (block?.triggerMode === true) {
          addParams.triggerMode = true
        }

        if (block?.advancedMode === true) {
          addParams.advancedMode = true
        }

        // Add inputs if present
        const inputs = extractInputValues(block)
        if (Object.keys(inputs).length > 0) {
          addParams.inputs = inputs
        }

        // Add connections if present
        const connections = extractConnections(blockId, endEdges)
        if (connections && Object.keys(connections).length > 0) {
          addParams.connections = connections
        }

        // Add nested nodes if present AND all children are new
        // This creates the loop/parallel with children in one operation
        // If some children already exist, they'll have separate insert_into_subflow operations
        if (block.nestedNodes && Object.keys(block.nestedNodes).length > 0) {
          const allChildrenNew = Object.keys(block.nestedNodes).every(
            (childId) => !(childId in startFlattened)
          )

          if (allChildrenNew) {
            addParams.nestedNodes = block.nestedNodes
            subflowsChanged++
          }
        }

        operations.push({
          operation_type: 'add',
          block_id: blockId,
          params: addParams,
        })
        blocksAdded++
      }
    }
  }

  // 3. Find modified blocks (exist in both but have changes)
  for (const blockId in endFlattened) {
    if (blockId in startFlattened) {
      const { block: startBlock, parentId: startParentId } = startFlattened[blockId]
      const { block: endBlock, parentId: endParentId } = endFlattened[blockId]

      // Check if parent changed (moved in/out of subflow)
      if (startParentId !== endParentId) {
        // Extract from old parent if it had one
        if (startParentId) {
          operations.push({
            operation_type: 'extract_from_subflow',
            block_id: blockId,
            params: { subflowId: startParentId },
          })
          subflowsChanged++
        }

        // Insert into new parent if it has one - include full block state
        if (endParentId) {
          const addParams: EditOperation['params'] = {
            subflowId: endParentId,
            type: endBlock.type,
            name: endBlock.name,
            outputs: endBlock.outputs,
            enabled: endBlock.enabled !== undefined ? endBlock.enabled : true,
          }

          // Only include triggerMode/advancedMode if true
          if (endBlock?.triggerMode === true) {
            addParams.triggerMode = true
          }
          if (endBlock?.advancedMode === true) {
            addParams.advancedMode = true
          }

          const inputs = extractInputValues(endBlock)
          if (Object.keys(inputs).length > 0) {
            addParams.inputs = inputs
          }

          const connections = extractConnections(blockId, endEdges)
          if (connections && Object.keys(connections).length > 0) {
            addParams.connections = connections
          }

          operations.push({
            operation_type: 'insert_into_subflow',
            block_id: blockId,
            params: addParams,
          })
          subflowsChanged++
        }
      }

      // Check for other changes (only if parent didn't change)
      const changes = computeBlockChanges(startBlock, endBlock, blockId, startEdges, endEdges)
      if (changes) {
        operations.push({
          operation_type: 'edit',
          block_id: blockId,
          params: changes,
        })
        blocksModified++
        if (changes.connections) {
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
      subflowsChanged,
    },
  }
}

/**
 * Extract input values from a block
 * Works with sanitized format where inputs is Record<string, value>
 */
function extractInputValues(block: any): Record<string, any> {
  // New sanitized format uses 'inputs' field
  if (block.inputs) {
    return { ...block.inputs }
  }

  // Fallback for any legacy data
  if (block.subBlocks) {
    return { ...block.subBlocks }
  }

  return {}
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

  // Check trigger mode change (covers entering/exiting trigger mode)
  const startTrigger = Boolean(startBlock?.triggerMode)
  const endTrigger = Boolean(endBlock?.triggerMode)
  if (startTrigger !== endTrigger) {
    changes.triggerMode = endTrigger
    hasChanges = true
  }

  // Check advanced mode change
  const startAdvanced = Boolean(startBlock?.advancedMode)
  const endAdvanced = Boolean(endBlock?.advancedMode)
  if (startAdvanced !== endAdvanced) {
    changes.advancedMode = endAdvanced
    hasChanges = true
  }

  // Check input value changes - only include changed fields
  const startInputs = extractInputValues(startBlock)
  const endInputs = extractInputValues(endBlock)

  const changedInputs = computeInputDelta(startInputs, endInputs)
  if (Object.keys(changedInputs).length > 0) {
    changes.inputs = changedInputs
    hasChanges = true
  }

  // Check connection changes
  const startConnections = extractConnections(blockId, startEdges)
  const endConnections = extractConnections(blockId, endEdges)

  if (JSON.stringify(startConnections) !== JSON.stringify(endConnections)) {
    changes.connections = endConnections
    hasChanges = true
  }

  return hasChanges ? changes : null
}

/**
 * Compute delta between two input objects
 * Only returns fields that actually changed or were added
 */
function computeInputDelta(
  startInputs: Record<string, any>,
  endInputs: Record<string, any>
): Record<string, any> {
  const delta: Record<string, any> = {}

  for (const key in endInputs) {
    if (TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(key)) {
      continue
    }
    if (
      !(key in startInputs) ||
      JSON.stringify(startInputs[key]) !== JSON.stringify(endInputs[key])
    ) {
      delta[key] = endInputs[key]
    }
  }

  return delta
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
      case 'insert_into_subflow':
        return `Insert "${op.params?.name || op.block_id}" into subflow "${op.params?.subflowId}"`
      case 'extract_from_subflow':
        return `Extract "${op.block_id}" from subflow "${op.params?.subflowId}"`
      case 'edit': {
        const changes: string[] = []
        if (op.params?.type) changes.push(`type to ${op.params.type}`)
        if (op.params?.name) changes.push(`name to "${op.params.name}"`)
        if (op.params?.triggerMode !== undefined)
          changes.push(`trigger mode to ${op.params.triggerMode}`)
        if (op.params?.advancedMode !== undefined)
          changes.push(`advanced mode to ${op.params.advancedMode}`)
        if (op.params?.inputs) {
          const inputKeys = Object.keys(op.params.inputs)
          if (inputKeys.length > 0) {
            changes.push(`inputs (${inputKeys.join(', ')})`)
          }
        }
        if (op.params?.connections) changes.push('connections')
        return `Edit block "${op.block_id}": ${changes.join(', ')}`
      }
      default:
        return `Unknown operation: ${op.operation_type}`
    }
  })
}
