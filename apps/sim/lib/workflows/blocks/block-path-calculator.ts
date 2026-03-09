/**
 * Shared utility for calculating block paths and accessible connections.
 * Used by both frontend (useBlockConnections) and backend (InputResolver) to ensure consistency.
 */
export class BlockPathCalculator {
  /**
   * Finds all blocks along paths leading to the target block.
   * This is a reverse traversal from the target node to find all ancestors
   * along connected paths using BFS.
   *
   * @param edges - List of all edges in the graph
   * @param targetNodeId - ID of the target block we're finding connections for
   * @returns Array of unique ancestor node IDs
   */
  static findAllPathNodes(
    edges: Array<{ source: string; target: string }>,
    targetNodeId: string
  ): string[] {
    // We'll use a reverse topological sort approach by tracking "distance" from target
    const nodeDistances = new Map<string, number>()
    const visited = new Set<string>()
    const queue: [string, number][] = [[targetNodeId, 0]] // [nodeId, distance]
    const pathNodes = new Set<string>()

    // Build a reverse adjacency list for faster traversal
    const reverseAdjList: Record<string, string[]> = {}
    for (const edge of edges) {
      if (!reverseAdjList[edge.target]) {
        reverseAdjList[edge.target] = []
      }
      reverseAdjList[edge.target].push(edge.source)
    }

    // BFS to find all ancestors and their shortest distance from target
    while (queue.length > 0) {
      const [currentNodeId, distance] = queue.shift()!

      if (visited.has(currentNodeId)) {
        // If we've seen this node before, update its distance if this path is shorter
        const currentDistance = nodeDistances.get(currentNodeId) || Number.POSITIVE_INFINITY
        if (distance < currentDistance) {
          nodeDistances.set(currentNodeId, distance)
        }
        continue
      }

      visited.add(currentNodeId)
      nodeDistances.set(currentNodeId, distance)

      // Don't add the target node itself to the results
      if (currentNodeId !== targetNodeId) {
        pathNodes.add(currentNodeId)
      }

      // Get all incoming edges from the reverse adjacency list
      const incomingNodeIds = reverseAdjList[currentNodeId] || []

      // Add all source nodes to the queue with incremented distance
      for (const sourceId of incomingNodeIds) {
        queue.push([sourceId, distance + 1])
      }
    }

    return Array.from(pathNodes)
  }
}
