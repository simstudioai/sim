import type { Edge } from 'reactflow'

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
      // Check for self-loops (node connecting to itself)
      if (neighbor === node) {
        allCycles.push([node])
        continue
      }

      if (!recursionStack.has(neighbor)) {
        if (!visited.has(neighbor)) {
          dfs(neighbor)
        }
      } else {
        // Found a cycle
        const cycleStartIndex = currentPath.indexOf(neighbor)
        if (cycleStartIndex !== -1) {
          const cycle = currentPath.slice(cycleStartIndex)
          // Include all cycles, even single-node ones
          allCycles.push([...cycle])
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
