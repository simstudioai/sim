import { useShallow } from 'zustand/react/shallow'
import { getEffectiveBlockOutputs } from '@/lib/workflows/blocks/block-outputs'
import { BlockPathCalculator } from '@/lib/workflows/blocks/block-path-calculator'
import { hasTriggerCapability } from '@/lib/workflows/triggers/trigger-utils'
import { getBlock } from '@/blocks'
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
  outputs?: Record<string, any>
}

export function useBlockConnections(blockId: string) {
  const { edges, blocks } = useWorkflowStore(
    useShallow((state) => ({
      edges: state.edges,
      blocks: state.blocks,
    }))
  )

  const workflowId = useWorkflowRegistry((state) => state.activeWorkflowId)

  const getMergedSubBlocks = (sourceBlockId: string): Record<string, any> => {
    const base = blocks[sourceBlockId]?.subBlocks || {}
    const workflowSubBlockValues = workflowId
      ? (useSubBlockStore.getState().workflowValues[workflowId] ?? {})
      : {}
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
      const blockConfig = getBlock(sourceBlock.type)
      const isTriggerCapable = blockConfig ? hasTriggerCapability(blockConfig) : false
      const effectiveTriggerMode = Boolean(sourceBlock.triggerMode && isTriggerCapable)

      const blockOutputs = getEffectiveBlockOutputs(sourceBlock.type, mergedSubBlocks, {
        triggerMode: effectiveTriggerMode,
        preferToolOutputs: !effectiveTriggerMode,
      })

      const outputFields: Field[] = Object.entries(blockOutputs).map(
        ([key, value]: [string, any]) => ({
          name: key,
          type: value && typeof value === 'object' && 'type' in value ? value.type : 'string',
          description:
            value && typeof value === 'object' && 'description' in value
              ? value.description
              : undefined,
        })
      )

      return {
        id: sourceBlock.id,
        type: sourceBlock.type,
        outputType: outputFields.map((field: Field) => field.name),
        name: sourceBlock.name,
        outputs: blockOutputs,
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
