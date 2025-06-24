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
    // Support both formats
    fields?: Field[]
    name?: string
    schema?: {
      type: string
      properties: Record<string, any>
      required?: string[]
    }
  }
}

// Helper function to extract fields from JSON Schema
function extractFieldsFromSchema(schema: any): Field[] {
  if (!schema || typeof schema !== 'object') {
    return []
  }

  // Handle legacy format with fields array
  if (Array.isArray(schema.fields)) {
    return schema.fields
  }

  // Handle new JSON Schema format
  const schemaObj = schema.schema || schema
  if (!schemaObj || !schemaObj.properties || typeof schemaObj.properties !== 'object') {
    return []
  }

  // Extract fields from schema properties
  return Object.entries(schemaObj.properties).map(([name, prop]: [string, any]) => ({
    name,
    type: prop.type || 'string',
    description: prop.description,
  }))
}

/**
 * Finds all blocks along paths leading to the target block
 * This is a reverse traversal from the target node to find all ancestors
 * along connected paths
 * @param edges - List of all edges in the graph
 * @param targetNodeId - ID of the target block we're finding connections for
 * @returns Array of unique ancestor node IDs
 */
function findAllPathNodes(edges: any[], targetNodeId: string): string[] {
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

export function useBlockConnections(blockId: string) {
  const { edges, blocks } = useWorkflowStore(
    (state) => ({
      edges: state.edges,
      blocks: state.blocks,
    }),
    shallow
  )

  // Find all blocks along paths leading to this block
  const allPathNodeIds = findAllPathNodes(edges, blockId)

  // Map each path node to a ConnectedBlock structure
  const allPathConnections = allPathNodeIds
    .map((sourceId) => {
      const sourceBlock = blocks[sourceId]
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
    })
    .filter(Boolean) as ConnectedBlock[]

  // Keep the original incoming connections for compatibility
  const directIncomingConnections = edges
    .filter((edge) => edge.target === blockId)
    .map((edge) => {
      const sourceBlock = blocks[edge.source]

      // Get the response format from the subblock store instead
      const responseFormatValue = useSubBlockStore
        .getState()
        .getValue(edge.source, 'responseFormat')

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
    })

  return {
    incomingConnections: allPathConnections,
    directIncomingConnections,
    hasIncomingConnections: allPathConnections.length > 0,
  }
}
