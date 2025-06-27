import { shallow } from 'zustand/shallow'
import { createLogger } from '@/lib/logs/console-logger'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('useBlockConnections')

interface Field {
  name: string
  type: string
  description?: string
}

export interface ConnectedBlock {
  id: string
  type: string
  outputType: string | string[]
  name: string
  responseFormat?: {
    schema?: {
      type: string
      properties: Record<string, any>
      required?: string[]
    }
  }
}

function extractFieldsFromSchema(responseFormat: any): Field[] {
  if (!responseFormat) return []

  const schema = responseFormat.schema || responseFormat
  if (
    !schema ||
    typeof schema !== 'object' ||
    !('properties' in schema) ||
    typeof schema.properties !== 'object' ||
    schema.properties === null
  ) {
    return []
  }

  return Object.entries(schema.properties).map(([name, prop]: [string, any]) => ({
    name,
    type: Array.isArray(prop) ? 'array' : prop.type || 'string',
    description: prop.description,
  }))
}

/**
 * Creates a ConnectedBlock object from a block with proper response format handling
 */
function createConnectedBlock(sourceBlock: any, sourceId: string): ConnectedBlock | null {
  if (!sourceBlock) return null

  // Get the response format from the subblock store
  const responseFormatValue = useSubBlockStore.getState().getValue(sourceId, 'responseFormat')

  let responseFormat

  try {
    responseFormat =
      typeof responseFormatValue === 'string' && responseFormatValue
        ? JSON.parse(responseFormatValue)
        : responseFormatValue // Handle case where it's already an object
  } catch (e) {
    logger.error('Failed to parse response format:', { e })
    responseFormat = undefined
  }

  // Get the default output type from the block's outputs
  const defaultOutputs: Field[] = Object.entries(sourceBlock.outputs || {}).map(([key]) => ({
    name: key,
    type: 'string',
  }))

  // Extract fields from the response format using our helper function
  const outputFields = responseFormat ? extractFieldsFromSchema(responseFormat) : defaultOutputs

  return {
    id: sourceBlock.id,
    type: sourceBlock.type,
    outputType: outputFields.map((field: Field) => field.name),
    name: sourceBlock.name,
    responseFormat,
  }
}

/**
 * Merges multiple ConnectedBlock instances for the same block ID
 */
function mergeConnectedBlocks(blocks: ConnectedBlock[]): ConnectedBlock {
  if (blocks.length === 1) return blocks[0]

  const firstBlock = blocks[0]
  const allOutputTypes = new Set<string>()

  // Collect all unique output types from all instances
  blocks.forEach((block) => {
    if (Array.isArray(block.outputType)) {
      block.outputType.forEach((type) => allOutputTypes.add(type))
    } else if (block.outputType) {
      allOutputTypes.add(block.outputType)
    }
  })

  // Use the response format from the first block that has one, or merge if needed
  const responseFormat = blocks.find((block) => block.responseFormat)?.responseFormat

  return {
    ...firstBlock,
    outputType: Array.from(allOutputTypes),
    responseFormat,
  }
}

/**
 * Finds all blocks along paths leading to the target block
 * This is a reverse traversal from the target node to find all ancestors
 * along connected paths
 * @param edges - List of all edges in the graph
 * @param targetNodeId - ID of the target block we're finding connections for
 * @returns Array of objects with node IDs and their distances from target
 */
function findAllPathNodes(
  edges: any[],
  targetNodeId: string
): Array<{ nodeId: string; distance: number }> {
  const nodeDistances = new Map<string, number>()
  const visited = new Set<string>()
  const queue: [string, number][] = [[targetNodeId, 0]] // [nodeId, distance]

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

    // Get all incoming edges from the reverse adjacency list
    const incomingNodeIds = reverseAdjList[currentNodeId] || []

    // Add all source nodes to the queue with incremented distance
    for (const sourceId of incomingNodeIds) {
      queue.push([sourceId, distance + 1])
    }
  }

  // Remove the target node itself and return sorted by distance (closest first)
  visited.delete(targetNodeId)

  return Array.from(visited)
    .map((nodeId) => ({ nodeId, distance: nodeDistances.get(nodeId) || 0 }))
    .sort((a, b) => a.distance - b.distance)
}

export function useBlockConnections(blockId: string) {
  const { edges, blocks } = useWorkflowStore(
    (state) => ({
      edges: state.edges,
      blocks: state.blocks,
    }),
    shallow
  )

  // Find all blocks along paths leading to this block
  const allPathNodes = findAllPathNodes(edges, blockId)

  // Create ConnectedBlock objects for all path nodes
  const pathConnections = allPathNodes
    .map(({ nodeId: sourceId }) => createConnectedBlock(blocks[sourceId], sourceId))
    .filter(Boolean) as ConnectedBlock[]

  // Deduplicate and merge blocks with the same ID
  const connectionMap = new Map<string, ConnectedBlock[]>()

  pathConnections.forEach((connection) => {
    if (!connectionMap.has(connection.id)) {
      connectionMap.set(connection.id, [])
    }
    connectionMap.get(connection.id)!.push(connection)
  })

  // Merge blocks with the same ID and sort by distance
  const allPathConnections = Array.from(connectionMap.entries())
    .map(([blockId, blockInstances]) => mergeConnectedBlocks(blockInstances))
    .sort((a, b) => {
      // Sort by distance (maintain original order based on first occurrence)
      const aDistance = allPathNodes.find((node) => node.nodeId === a.id)?.distance || 0
      const bDistance = allPathNodes.find((node) => node.nodeId === b.id)?.distance || 0
      return aDistance - bDistance
    })

  // Keep the original direct incoming connections for compatibility
  const directIncomingConnections = edges
    .filter((edge) => edge.target === blockId)
    .map((edge) => createConnectedBlock(blocks[edge.source], edge.source))
    .filter(Boolean) as ConnectedBlock[]

  // Deduplicate direct connections as well
  const directConnectionMap = new Map<string, ConnectedBlock[]>()

  directIncomingConnections.forEach((connection) => {
    if (!directConnectionMap.has(connection.id)) {
      directConnectionMap.set(connection.id, [])
    }
    directConnectionMap.get(connection.id)!.push(connection)
  })

  const deduplicatedDirectConnections = Array.from(directConnectionMap.entries()).map(
    ([blockId, blockInstances]) => mergeConnectedBlocks(blockInstances)
  )

  return {
    incomingConnections: allPathConnections,
    directIncomingConnections: deduplicatedDirectConnections,
    hasIncomingConnections: allPathConnections.length > 0,
  }
}
