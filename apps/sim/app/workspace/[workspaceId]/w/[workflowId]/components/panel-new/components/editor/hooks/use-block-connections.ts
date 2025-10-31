import { shallow } from 'zustand/shallow'
import { BlockPathCalculator } from '@/lib/block-path-calculator'
import { extractFieldsFromSchema, parseResponseFormatSafely } from '@/lib/response-format'
import { getBlockOutputs } from '@/lib/workflows/block-outputs'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

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
  outputs?: Record<string, any>
  operation?: string
}

export function useBlockConnections(blockId: string) {
  const { edges, blocks } = useWorkflowStore(
    (state) => ({
      edges: state.edges,
      blocks: state.blocks,
    }),
    shallow
  )

  const workflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const workflowSubBlockValues = useSubBlockStore((state) =>
    workflowId ? (state.workflowValues[workflowId] ?? {}) : {}
  )

  // Helper function to merge block subBlocks with live values from subblock store
  const getMergedSubBlocks = (sourceBlockId: string): Record<string, any> => {
    const base = blocks[sourceBlockId]?.subBlocks || {}
    const live = workflowSubBlockValues?.[sourceBlockId] || {}
    const merged: Record<string, any> = { ...base }
    for (const [subId, liveVal] of Object.entries(live)) {
      merged[subId] = { ...(base[subId] || {}), value: liveVal }
    }
    return merged
  }

  // Early return if block doesn't exist or has no incoming edges
  // This prevents triggers and unconnected blocks from showing phantom connections
  const directIncomingEdges = edges.filter((edge) => edge.target === blockId)

  if (!blocks[blockId] || directIncomingEdges.length === 0) {
    return {
      incomingConnections: [],
      hasIncomingConnections: false,
    }
  }

  // Find all blocks along paths leading to this block using BlockPathCalculator
  // This returns blocks that are connected via edges in the execution path
  const pathNodeIds = BlockPathCalculator.findAllPathNodes(edges, blockId)

  // Calculate distances for sorting (closest blocks first)
  const nodeDistances = new Map<string, number>()
  const visited = new Set<string>()
  const queue: [string, number][] = [[blockId, 0]]

  // BFS to calculate distances
  while (queue.length > 0) {
    const [currentNodeId, distance] = queue.shift()!
    if (visited.has(currentNodeId)) continue

    visited.add(currentNodeId)
    nodeDistances.set(currentNodeId, distance)

    // Find incoming edges
    const incomingEdges = edges.filter((edge) => edge.target === currentNodeId)
    for (const edge of incomingEdges) {
      if (!visited.has(edge.source)) {
        queue.push([edge.source, distance + 1])
      }
    }
  }

  // Map path nodes to ConnectedBlock structures and sort by distance
  const incomingConnections = pathNodeIds
    .map((sourceId) => {
      const sourceBlock = blocks[sourceId]
      if (!sourceBlock) return null

      // Get merged subblocks for this source block
      const mergedSubBlocks = getMergedSubBlocks(sourceId)

      // Get the response format from the subblock store
      const responseFormatValue = useSubBlockStore.getState().getValue(sourceId, 'responseFormat')

      // Safely parse response format with proper error handling
      const responseFormat = parseResponseFormatSafely(responseFormatValue, sourceId)

      // Get operation value for tool-based blocks
      const operationValue = useSubBlockStore.getState().getValue(sourceId, 'operation')

      // Use getBlockOutputs to properly handle dynamic outputs from inputFormat
      const blockOutputs = getBlockOutputs(
        sourceBlock.type,
        mergedSubBlocks,
        sourceBlock.triggerMode
      )

      // Extract fields from the response format if available, otherwise use block outputs
      let outputFields: Field[]
      if (responseFormat) {
        outputFields = extractFieldsFromSchema(responseFormat)
      } else {
        // Convert block outputs to field format
        outputFields = Object.entries(blockOutputs).map(([key, value]: [string, any]) => ({
          name: key,
          type: value && typeof value === 'object' && 'type' in value ? value.type : 'string',
          description:
            value && typeof value === 'object' && 'description' in value
              ? value.description
              : undefined,
        }))
      }

      return {
        id: sourceBlock.id,
        type: sourceBlock.type,
        outputType: outputFields.map((field: Field) => field.name),
        name: sourceBlock.name,
        responseFormat,
        outputs: blockOutputs,
        operation: operationValue,
        distance: nodeDistances.get(sourceId) || Number.POSITIVE_INFINITY,
      }
    })
    .filter((conn): conn is NonNullable<typeof conn> => conn !== null)
    .sort((a, b) => a.distance - b.distance) // Sort by distance, closest first
    .map(({ distance: _distance, ...conn }) => conn) as ConnectedBlock[] // Remove distance from final result

  return {
    incomingConnections,
    hasIncomingConnections: incomingConnections.length > 0,
  }
}
