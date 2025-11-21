import { useEffect, useMemo, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { useDebounce } from '@/hooks/use-debounce'
import { useOperationQueueStore } from '@/stores/operation-queue/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('useChangeDetection')

interface UseChangeDetectionProps {
  workflowId: string | null
  deployedState: WorkflowState | null
  isLoadingDeployedState: boolean
}

/**
 * Hook to detect changes between current workflow state and deployed state
 * Uses API-based change detection for accuracy
 */
export function useChangeDetection({
  workflowId,
  deployedState,
  isLoadingDeployedState,
}: UseChangeDetectionProps) {
  const [changeDetected, setChangeDetected] = useState(false)
  const [blockStructureVersion, setBlockStructureVersion] = useState(0)
  const [edgeStructureVersion, setEdgeStructureVersion] = useState(0)
  const [subBlockStructureVersion, setSubBlockStructureVersion] = useState(0)

  // Get current store state for change detection
  const currentBlocks = useWorkflowStore((state) => state.blocks)
  const currentEdges = useWorkflowStore((state) => state.edges)
  const lastSaved = useWorkflowStore((state) => state.lastSaved)
  const subBlockValues = useSubBlockStore((state) =>
    workflowId ? state.workflowValues[workflowId] : null
  )

  // Track structure changes
  useEffect(() => {
    setBlockStructureVersion((version) => version + 1)
  }, [currentBlocks])

  useEffect(() => {
    setEdgeStructureVersion((version) => version + 1)
  }, [currentEdges])

  useEffect(() => {
    setSubBlockStructureVersion((version) => version + 1)
  }, [subBlockValues])

  // Reset version counters when workflow changes
  useEffect(() => {
    setBlockStructureVersion(0)
    setEdgeStructureVersion(0)
    setSubBlockStructureVersion(0)
  }, [workflowId])

  // Create trigger for status check
  const statusCheckTrigger = useMemo(() => {
    return JSON.stringify({
      lastSaved: lastSaved ?? 0,
      blockVersion: blockStructureVersion,
      edgeVersion: edgeStructureVersion,
      subBlockVersion: subBlockStructureVersion,
    })
  }, [lastSaved, blockStructureVersion, edgeStructureVersion, subBlockStructureVersion])

  const debouncedStatusCheckTrigger = useDebounce(statusCheckTrigger, 500)

  useEffect(() => {
    // Avoid off-by-one false positives: wait until operation queue is idle
    const { operations, isProcessing } = useOperationQueueStore.getState()
    const hasPendingOps =
      isProcessing || operations.some((op) => op.status === 'pending' || op.status === 'processing')

    if (!workflowId || !deployedState) {
      setChangeDetected(false)
      return
    }

    if (isLoadingDeployedState || hasPendingOps) {
      return
    }

    // Use the workflow status API to get accurate change detection
    // This uses the same logic as the deployment API (reading from normalized tables)
    const checkForChanges = async () => {
      try {
        const response = await fetch(`/api/workflows/${workflowId}/status`)
        if (response.ok) {
          const data = await response.json()
          setChangeDetected(data.needsRedeployment || false)
        } else {
          logger.error('Failed to fetch workflow status:', response.status, response.statusText)
          setChangeDetected(false)
        }
      } catch (error) {
        logger.error('Error fetching workflow status:', error)
        setChangeDetected(false)
      }
    }

    checkForChanges()
  }, [workflowId, deployedState, debouncedStatusCheckTrigger, isLoadingDeployedState])

  return {
    changeDetected,
    setChangeDetected,
  }
}
