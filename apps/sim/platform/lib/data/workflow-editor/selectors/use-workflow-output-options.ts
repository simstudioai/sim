import { useMemo } from 'react'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { useShallow } from 'zustand/react/shallow'
import {
  buildWorkflowOutputOptions,
  collectReferencedWorkflowIds,
  type WorkflowOutputOption,
} from '@/lib/workflows/streaming/nested-output-options'
import { formatPublicOutputSelector } from '@/lib/workflows/streaming/output-selector'
import { DEFAULTS, normalizeName } from '@/executor/constants'
import { useWorkflowStates } from '@/hooks/queries/workflows'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/** The stored value for an output: a public dot selector, scoped to its child workflow. */
export function publicOutputValue(output: WorkflowOutputOption): string {
  return formatPublicOutputSelector(normalizeName(output.blockName), output.path, output.workflowId)
}

/**
 * Every output of the open workflow (the baseline while a diff is hidden) and of the workflows its
 * Workflow blocks call, three levels deep, as the chat and API output pickers list them.
 */
export function useWorkflowOutputOptions(workflowId: string | null): WorkflowOutputOption[] {
  const blocks = useWorkflowStore((state) => state.blocks)
  const edges = useWorkflowStore((state) => state.edges)
  const { isShowingDiff, isDiffReady, hasActiveDiff, baselineWorkflow } = useWorkflowDiffStore(
    useShallow((state) => ({
      isShowingDiff: state.isShowingDiff,
      isDiffReady: state.isDiffReady,
      hasActiveDiff: state.hasActiveDiff,
      baselineWorkflow: state.baselineWorkflow,
    }))
  )
  const subBlockValues = useSubBlockStore((state) =>
    workflowId ? state.workflowValues[workflowId] : null
  )

  const useBaseline = Boolean(hasActiveDiff && isDiffReady && !isShowingDiff && baselineWorkflow)
  const workflowBlocks = useBaseline && baselineWorkflow ? baselineWorkflow.blocks : blocks
  const workflowEdges = useBaseline && baselineWorkflow ? baselineWorkflow.edges : edges

  const rootState = useMemo<Pick<WorkflowState, 'blocks' | 'edges'>>(() => {
    if (!workflowId || !workflowBlocks || typeof workflowBlocks !== 'object')
      return { blocks: {}, edges: [] }
    const merged = (Object.values(workflowBlocks) as BlockState[]).map((block): BlockState => {
      const raw =
        useBaseline && baselineWorkflow
          ? baselineWorkflow.blocks?.[block.id]?.subBlocks
          : subBlockValues?.[block.id]
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
      edges: workflowEdges,
    }
  }, [workflowBlocks, workflowEdges, workflowId, baselineWorkflow, subBlockValues, useBaseline])

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
