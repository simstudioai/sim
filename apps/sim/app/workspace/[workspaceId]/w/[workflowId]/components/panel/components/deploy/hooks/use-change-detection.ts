import { useEffect, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { hasWorkflowChanged } from '@/lib/workflows/comparison'
import { mergeSubblockStateWithValues } from '@/lib/workflows/subblocks'
import { deploymentKeys } from '@/hooks/queries/deployments'
import { useVariablesStore } from '@/stores/panel/variables/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

interface UseChangeDetectionProps {
  workflowId: string | null
  deployedState: WorkflowState | null
  isLoadingDeployedState: boolean
  serverNeedsRedeployment: boolean | undefined
  isServerLoading: boolean
}

/**
 * Detects meaningful changes between current workflow state and deployed state.
 *
 * Uses the server-side needsRedeployment (from useDeploymentInfo) as the
 * authoritative signal. The server compares the persisted DB state to the
 * deployed version state, which avoids false positives from client-side
 * representation differences.
 *
 * When the workflow store is updated (e.g. after auto-save), the deployment
 * info query is invalidated so the server can recheck for changes.
 */
export function useChangeDetection({
  workflowId,
  deployedState,
  isLoadingDeployedState,
  serverNeedsRedeployment,
  isServerLoading,
}: UseChangeDetectionProps) {
  const queryClient = useQueryClient()
  const blocks = useWorkflowStore((state) => state.blocks)
  const edges = useWorkflowStore((state) => state.edges)
  const loops = useWorkflowStore((state) => state.loops)
  const parallels = useWorkflowStore((state) => state.parallels)
  const lastSaved = useWorkflowStore((state) => state.lastSaved)
  const subBlockValues = useSubBlockStore((state) =>
    workflowId ? state.workflowValues[workflowId] : null
  )
  const allVariables = useVariablesStore((state) => state.variables)
  const workflowVariables = useMemo(() => {
    if (!workflowId) return {}
    const vars: Record<string, any> = {}
    for (const [id, variable] of Object.entries(allVariables)) {
      if (variable.workflowId === workflowId) {
        vars[id] = variable
      }
    }
    return vars
  }, [workflowId, allVariables])

  // Tracks the lastSaved timestamp at mount to distinguish real saves from initial hydration.
  const initialLastSavedRef = useRef<number | undefined>(undefined)
  const workflowIdRef = useRef(workflowId)

  // Must run before the lastSaved effect to prevent stale-ref invalidation on workflow switch.
  useEffect(() => {
    workflowIdRef.current = workflowId
    initialLastSavedRef.current = undefined
  }, [workflowId])

  useEffect(() => {
    if (lastSaved !== undefined && initialLastSavedRef.current === undefined) {
      initialLastSavedRef.current = lastSaved
      return
    }

    if (
      lastSaved === undefined ||
      initialLastSavedRef.current === undefined ||
      lastSaved === initialLastSavedRef.current ||
      !workflowId
    ) {
      return
    }

    initialLastSavedRef.current = lastSaved

    const capturedWorkflowId = workflowId
    const timer = setTimeout(() => {
      if (workflowIdRef.current !== capturedWorkflowId) return
      queryClient.invalidateQueries({
        queryKey: deploymentKeys.info(capturedWorkflowId),
      })
    }, 500)

    return () => clearTimeout(timer)
  }, [lastSaved, workflowId, queryClient])

  // Skip expensive state merge when server result is available (the common path).
  // Only build currentState for the client-side fallback comparison.
  const needsClientFallback = serverNeedsRedeployment === undefined && !isServerLoading

  const currentState = useMemo((): WorkflowState | null => {
    if (!needsClientFallback || !workflowId || !deployedState) return null

    const mergedBlocks = mergeSubblockStateWithValues(blocks, subBlockValues ?? {})

    return {
      blocks: mergedBlocks,
      edges,
      loops,
      parallels,
      variables: workflowVariables,
    } as WorkflowState & { variables: Record<string, any> }
  }, [
    needsClientFallback,
    workflowId,
    deployedState,
    blocks,
    edges,
    loops,
    parallels,
    subBlockValues,
    workflowVariables,
  ])

  const changeDetected = useMemo(() => {
    if (isServerLoading) return false

    if (serverNeedsRedeployment !== undefined) {
      return serverNeedsRedeployment
    }

    if (!currentState || !deployedState || isLoadingDeployedState) return false
    return hasWorkflowChanged(currentState, deployedState)
  }, [
    currentState,
    deployedState,
    isLoadingDeployedState,
    serverNeedsRedeployment,
    isServerLoading,
  ])

  return { changeDetected }
}
