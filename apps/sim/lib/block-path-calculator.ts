import type { SerializedWorkflow } from '@/serializer/types'

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

  /**
   * Calculates accessible blocks for all blocks in a workflow.
   * This ensures consistent block reference resolution across frontend and backend.
   *
   * @param workflow - The serialized workflow
   * @returns Map of block ID to Set of accessible block IDs
   */
  static calculateAccessibleBlocksForWorkflow(
    workflow: SerializedWorkflow
  ): Map<string, Set<string>> {
    const accessibleMap = new Map<string, Set<string>>()

    for (const block of workflow.blocks) {
      const accessibleBlocks = new Set<string>()

      // Find all blocks along paths leading to this block
      const pathNodes = BlockPathCalculator.findAllPathNodes(workflow.connections, block.id)
      pathNodes.forEach((nodeId) => accessibleBlocks.add(nodeId))

      // Always allow referencing the starter block (special case)
      const starterBlock = workflow.blocks.find((b) => b.metadata?.id === 'starter')
      if (starterBlock && starterBlock.id !== block.id) {
        accessibleBlocks.add(starterBlock.id)
      }

      accessibleMap.set(block.id, accessibleBlocks)
    }

    return accessibleMap
  }

  /**
   * Gets accessible block names for a specific block (for error messages).
   *
   * @param blockId - The block ID to get accessible names for
   * @param workflow - The serialized workflow
   * @param accessibleBlocksMap - Pre-calculated accessible blocks map
   * @returns Array of accessible block names and aliases
   */
  static getAccessibleBlockNames(
    blockId: string,
    workflow: SerializedWorkflow,
    accessibleBlocksMap: Map<string, Set<string>>
  ): string[] {
    const accessibleBlockIds = accessibleBlocksMap.get(blockId) || new Set<string>()
    const names: string[] = []

    // Create a map of block IDs to blocks for efficient lookup
    const blockById = new Map(workflow.blocks.map((block) => [block.id, block]))

    for (const accessibleBlockId of accessibleBlockIds) {
      const block = blockById.get(accessibleBlockId)
      if (block) {
        // Add both the actual name and the normalized name
        if (block.metadata?.name) {
          names.push(block.metadata.name)
          names.push(block.metadata.name.toLowerCase().replace(/\s+/g, ''))
        }
        names.push(accessibleBlockId)
      }
    }

    // Add special aliases
    names.push('start') // Always allow start alias

    return [...new Set(names)] // Remove duplicates
  }
}
