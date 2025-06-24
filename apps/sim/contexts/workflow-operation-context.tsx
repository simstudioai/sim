'use client'

import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { isCollaborationEnabled } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console-logger'
import type { LocalWorkflowOperations } from '@/lib/workflows/local-operations'
import {
  createWorkflowOperationManager,
  type WorkflowOperationManager,
} from '@/lib/workflows/operation-manager'
import { useSocket } from '@/contexts/socket-context'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'

const logger = createLogger('WorkflowOperationContext')

interface WorkflowOperationContextType {
  operationManager: WorkflowOperationManager | null
  isCollaborative: boolean
  isReady: boolean
  // For non-collaborative mode
  localOperations?: LocalWorkflowOperations
}

const WorkflowOperationContext = createContext<WorkflowOperationContextType>({
  operationManager: null,
  isCollaborative: false,
  isReady: false,
})

export const useWorkflowOperations = () => useContext(WorkflowOperationContext)

interface WorkflowOperationProviderProps {
  children: ReactNode
  workflowId: string
}

export function WorkflowOperationProvider({
  children,
  workflowId,
}: WorkflowOperationProviderProps) {
  const [operationManager, setOperationManager] = useState<WorkflowOperationManager | null>(null)
  const [isReady, setIsReady] = useState(false)

  const collaborationEnabled = isCollaborationEnabled()
  const collaborativeHook = useCollaborativeWorkflow()
  const { isConnected } = useSocket()

  useEffect(() => {
    if (!workflowId) {
      setOperationManager(null)
      setIsReady(false)
      return
    }

    logger.info(`Initializing workflow operations for ${workflowId}`, {
      collaborationEnabled,
      isConnected: collaborationEnabled ? isConnected : true,
    })

    // Cleanup previous operation manager if it exists
    setOperationManager((prevManager) => {
      if (prevManager && 'destroy' in prevManager && typeof prevManager.destroy === 'function') {
        prevManager.destroy()
      }
      return null
    })

    // For collaborative mode, wait for socket connection
    if (collaborationEnabled) {
      if (isConnected) {
        const manager = createWorkflowOperationManager(workflowId, true, collaborativeHook)
        setOperationManager(manager)
        setIsReady(true)
        logger.info(`Collaborative operations ready for workflow ${workflowId}`)
      } else {
        setOperationManager(null)
        setIsReady(false)
        logger.info(`Waiting for socket connection for workflow ${workflowId}`)
      }
    } else {
      // For local mode, create immediately
      const manager = createWorkflowOperationManager(workflowId, false)
      setOperationManager(manager)
      setIsReady(true)
      logger.info(`Local operations ready for workflow ${workflowId}`)
    }
  }, [workflowId, collaborationEnabled, isConnected])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (operationManager && 'destroy' in operationManager && typeof operationManager.destroy === 'function') {
        operationManager.destroy()
      }
    }
  }, [operationManager])

  const contextValue: WorkflowOperationContextType = {
    operationManager,
    isCollaborative: collaborationEnabled,
    isReady,
    localOperations:
      !collaborationEnabled && operationManager
        ? (operationManager as LocalWorkflowOperations)
        : undefined,
  }

  return (
    <WorkflowOperationContext.Provider value={contextValue}>
      {children}
    </WorkflowOperationContext.Provider>
  )
}

/**
 * Hook to get workflow operations with proper typing
 */
export function useWorkflowOperationsTyped() {
  const context = useWorkflowOperations()

  if (!context.operationManager) {
    throw new Error(
      'Workflow operations not ready. Make sure WorkflowOperationProvider is mounted and ready.'
    )
  }

  return {
    ...context.operationManager,
    isCollaborative: context.isCollaborative,
    isReady: context.isReady,
    localOperations: context.localOperations,
  }
}

/**
 * Hook to safely get workflow operations (returns null if not ready)
 */
export function useWorkflowOperationsSafe() {
  const context = useWorkflowOperations()

  return {
    operationManager: context.operationManager,
    isCollaborative: context.isCollaborative,
    isReady: context.isReady,
    localOperations: context.localOperations,
  }
}
