import { Edge } from 'reactflow'
import { useWorkflowRegistry } from './registry/store'
import { useSubBlockStore } from './subblock/store'
import { BlockState, SubBlockState } from './types'

/**
 * Merges workflow block states with subblock values while maintaining block structure
 * @param blocks - Block configurations from workflow store
 * @param workflowId - ID of the workflow to merge values for
 * @param blockId - Optional specific block ID to merge (merges all if not provided)
 * @returns Merged block states with updated values
 */
export function mergeSubblockState(
  blocks: Record<string, BlockState>,
  workflowId?: string,
  blockId?: string
): Record<string, BlockState> {
  const blocksToProcess = blockId ? { [blockId]: blocks[blockId] } : blocks
  const subBlockStore = useSubBlockStore.getState()

  return Object.entries(blocksToProcess).reduce(
    (acc, [id, block]) => {
      // Skip if block is undefined or doesn't have subBlocks
      if (!block || !block.subBlocks) {
        return acc
      }

      // Create a deep copy of the block's subBlocks to maintain structure
      const mergedSubBlocks = Object.entries(block.subBlocks).reduce(
        (subAcc, [subBlockId, subBlock]) => {
          // Skip if subBlock is undefined
          if (!subBlock) {
            return subAcc
          }

          // Get the stored value for this subblock
          let storedValue = null

          // If workflowId is provided, use it to get the value
          if (workflowId) {
            // Try to get the value from the subblock store for this specific workflow
            const workflowValues = subBlockStore.workflowValues[workflowId]
            if (workflowValues && workflowValues[id]) {
              storedValue = workflowValues[id][subBlockId]
            }
          } else {
            // Fall back to the active workflow if no workflowId is provided
            storedValue = subBlockStore.getValue(id, subBlockId)
          }

          // Create a new subblock object with the same structure but updated value
          subAcc[subBlockId] = {
            ...subBlock,
            value: storedValue !== undefined && storedValue !== null ? storedValue : subBlock.value,
          }

          return subAcc
        },
        {} as Record<string, SubBlockState>
      )

      // Return the full block state with updated subBlocks
      acc[id] = {
        ...block,
        subBlocks: mergedSubBlocks,
      }

      return acc
    },
    {} as Record<string, BlockState>
  )
}

/**
 * Performs a depth-first search to detect all cycles in the graph
 * @param edges - List of all edges in the graph
 * @param startNode - Starting node for cycle detection
 * @returns Array of all unique cycles found in the graph
 */
export function detectCycle(
  edges: Edge[],
  startNode: string
): { hasCycle: boolean; paths: string[][] } {
  const visited = new Set<string>()
  const recursionStack = new Set<string>()
  const allCycles: string[][] = []
  const currentPath: string[] = []

  function dfs(node: string) {
    visited.add(node)
    recursionStack.add(node)
    currentPath.push(node)

    // Get all neighbors of current node
    const neighbors = edges.filter((edge) => edge.source === node).map((edge) => edge.target)

    for (const neighbor of neighbors) {
      if (!recursionStack.has(neighbor)) {
        if (!visited.has(neighbor)) {
          dfs(neighbor)
        }
      } else {
        // Found a cycle
        const cycleStartIndex = currentPath.indexOf(neighbor)
        if (cycleStartIndex !== -1) {
          const cycle = currentPath.slice(cycleStartIndex)
          // Only add cycles with length > 1
          if (cycle.length > 1) {
            allCycles.push([...cycle])
          }
        }
      }
    }

    currentPath.pop()
    recursionStack.delete(node)
  }

  dfs(startNode)

  return {
    hasCycle: allCycles.length > 0,
    paths: allCycles,
  }
}
