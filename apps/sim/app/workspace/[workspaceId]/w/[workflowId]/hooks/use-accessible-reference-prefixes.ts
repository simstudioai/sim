import { useMemo } from 'react'
import { BlockPathCalculator } from '@/lib/workflows/blocks/block-path-calculator'
import { SYSTEM_REFERENCE_PREFIXES } from '@/lib/workflows/sanitization/references'
import { useWorkflowReferenceGraph } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/workflow-reference-scope'
import { normalizeName } from '@/executor/constants'
import type { Loop, Parallel } from '@/stores/workflows/workflow/types'

export function useAccessibleReferencePrefixes(blockId?: string | null): Set<string> | undefined {
  // The GRAPH only — this runs on every keystroke in every reference-aware sub-block editor,
  // and reachability cannot change with the values being typed.
  const { blocks, edges, loops, parallels, unrestricted } = useWorkflowReferenceGraph()

  return useMemo(() => {
    if (!blockId) {
      return undefined
    }

    const accessibleIds = new Set<string>()
    if (unrestricted) {
      // The referencing block is not in this graph, so there is no path to walk. Every block
      // is offered instead of none — see `WorkflowReferenceScope.unrestricted`.
      Object.keys(blocks).forEach((id) => accessibleIds.add(id))
    } else {
      const graphEdges = edges.map((edge) => ({ source: edge.source, target: edge.target }))
      BlockPathCalculator.findAllPathNodes(graphEdges, blockId).forEach((id) =>
        accessibleIds.add(id)
      )
    }
    accessibleIds.add(blockId)

    Object.values(loops as Record<string, Loop>).forEach((loop) => {
      if (loop?.nodes?.includes(blockId)) accessibleIds.add(loop.id)
    })

    Object.values(parallels as Record<string, Parallel>).forEach((parallel) => {
      if (parallel?.nodes?.includes(blockId)) accessibleIds.add(parallel.id)
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
  }, [blockId, blocks, edges, loops, parallels, unrestricted])
}
