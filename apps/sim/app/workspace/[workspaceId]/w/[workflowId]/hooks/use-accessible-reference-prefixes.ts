import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { BlockPathCalculator } from '@/lib/workflows/blocks/block-path-calculator'
import { SYSTEM_REFERENCE_PREFIXES } from '@/lib/workflows/sanitization/references'
import { isInputDefinitionTrigger } from '@/lib/workflows/triggers/input-definition-triggers'
import { normalizeName } from '@/executor/constants'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { Loop, Parallel } from '@/stores/workflows/workflow/types'

export function useAccessibleReferencePrefixes(blockId?: string | null): Set<string> | undefined {
  const { blocks, edges, loops, parallels } = useWorkflowStore(
    useShallow((state) => ({
      blocks: state.blocks,
      edges: state.edges,
      loops: state.loops || {},
      parallels: state.parallels || {},
    }))
  )

  return useMemo(() => {
    if (!blockId) {
      return undefined
    }

    const graphEdges = edges.map((edge) => ({ source: edge.source, target: edge.target }))
    const ancestorIds = BlockPathCalculator.findAllPathNodes(graphEdges, blockId)
    const accessibleIds = new Set<string>(ancestorIds)
    accessibleIds.add(blockId)

    const starterBlock = Object.values(blocks).find((block) => isInputDefinitionTrigger(block.type))
    if (starterBlock && ancestorIds.includes(starterBlock.id)) {
      accessibleIds.add(starterBlock.id)
    }

    const loopValues = Object.values(loops as Record<string, Loop>)
    loopValues.forEach((loop) => {
      if (!loop?.nodes) return
      if (loop.nodes.includes(blockId)) {
        accessibleIds.add(loop.id) // Add the loop block itself
        loop.nodes.forEach((nodeId) => accessibleIds.add(nodeId))
      }
    })

    const parallelValues = Object.values(parallels as Record<string, Parallel>)
    parallelValues.forEach((parallel) => {
      if (!parallel?.nodes) return
      if (parallel.nodes.includes(blockId)) {
        accessibleIds.add(parallel.id) // Add the parallel block itself
        parallel.nodes.forEach((nodeId) => accessibleIds.add(nodeId))
      }
    })

    const prefixes = new Set<string>()
    accessibleIds.forEach((id) => {
      prefixes.add(normalizeName(id))
      const block = blocks[id]
      if (block?.name) {
        prefixes.add(normalizeName(block.name))
      }
    })

    SYSTEM_REFERENCE_PREFIXES.forEach((prefix) => prefixes.add(prefix))

    return prefixes
  }, [blockId, blocks, edges, loops, parallels])
}
