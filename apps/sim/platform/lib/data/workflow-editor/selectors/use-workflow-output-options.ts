import { useMemo } from 'react'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import {
  buildWorkflowOutputOptions,
  collectReferencedWorkflowIds,
  type WorkflowOutputOption,
} from '@/lib/workflows/streaming/nested-output-options'
import { formatPublicOutputSelector } from '@/lib/workflows/streaming/output-selector'
import { DEFAULTS, normalizeName } from '@/executor/constants'
import { useWorkflowStates } from '@/hooks/queries/workflows'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/** The stored value for an output: a public dot selector, scoped to its child workflow. */
export function publicOutputValue(output: WorkflowOutputOption): string {
  return formatPublicOutputSelector(normalizeName(output.blockName), output.path, output.workflowId)
}

/**
 * Every output of the open workflow and of the workflows its Workflow blocks call, three levels
 * deep, as the chat and API output pickers list them.
 */
export function useWorkflowOutputOptions(workflowId: string | null): WorkflowOutputOption[] {
  const blocks = useWorkflowStore((state) => state.blocks)
  const edges = useWorkflowStore((state) => state.edges)
  const subBlockValues = useSubBlockStore((state) =>
    workflowId ? state.workflowValues[workflowId] : null
  )

  const rootState = useMemo<Pick<WorkflowState, 'blocks' | 'edges'>>(() => {
    if (!workflowId || !blocks || typeof blocks !== 'object') return { blocks: {}, edges: [] }
    const merged = (Object.values(blocks) as BlockState[]).map((block): BlockState => {
      const raw = subBlockValues?.[block.id]
      const subBlocks: Record<string, unknown> = {}
      if (raw && typeof raw === 'object') {
        for (const [key, value] of Object.entries(raw)) {
          subBlocks[key] =
            value && typeof value === 'object' && 'value' in value ? value : { value }
        }
      }
      return { ...block, subBlocks } as BlockState
    })
    return {
      blocks: Object.fromEntries(merged.map((block) => [block.id, block])),
      edges,
    }
  }, [blocks, edges, workflowId, subBlockValues])

  const firstLevelIds = useMemo(() => collectReferencedWorkflowIds([rootState]), [rootState])
  const firstLevel = useWorkflowStates(firstLevelIds)
  const secondLevel = useWorkflowStates(collectReferencedWorkflowIds(firstLevel.values()))
  const thirdLevel = useWorkflowStates(collectReferencedWorkflowIds(secondLevel.values()))

  return workflowId
    ? buildWorkflowOutputOptions({
        rootWorkflowId: workflowId,
        rootState,
        workflowStates: new Map([...firstLevel, ...secondLevel, ...thirdLevel]),
        maxChildDepth: DEFAULTS.MAX_SSE_CHILD_DEPTH,
      })
    : []
}
