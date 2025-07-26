import { useCallback, useState } from 'react'
import { useParams } from 'next/navigation'
import { createLogger } from '@/lib/logs/console-logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('useCopilotSandbox')

interface SandboxState {
  isOpen: boolean
  proposedWorkflowState: WorkflowState | null
  yamlContent: string
  description?: string
  isProcessing: boolean
}

export function useCopilotSandbox() {
  const [sandboxState, setSandboxState] = useState<SandboxState>({
    isOpen: false,
    proposedWorkflowState: null,
    yamlContent: '',
    description: undefined,
    isProcessing: false,
  })

  const params = useParams()
  const workspaceId = params.workspaceId as string
  const { activeWorkflowId, createWorkflow } = useWorkflowRegistry()

  const showSandbox = useCallback(
    (workflowState: WorkflowState, yamlContent: string, description?: string) => {
      setSandboxState({
        isOpen: true,
        proposedWorkflowState: workflowState,
        yamlContent,
        description,
        isProcessing: false,
      })
    },
    []
  )

  const closeSandbox = useCallback(() => {
    setSandboxState({
      isOpen: false,
      proposedWorkflowState: null,
      yamlContent: '',
      description: undefined,
      isProcessing: false,
    })
  }, [])

  const applyToCurrentWorkflow = useCallback(async () => {
    if (!activeWorkflowId || !sandboxState.yamlContent) {
      throw new Error('No active workflow or YAML content')
    }

    try {
      setSandboxState((prev) => ({ ...prev, isProcessing: true }))

      logger.info('Applying sandbox workflow to current workflow', {
        workflowId: activeWorkflowId,
        yamlLength: sandboxState.yamlContent.length,
      })

      // Use the existing YAML endpoint to apply the changes
      const response = await fetch(`/api/workflows/${activeWorkflowId}/yaml`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          yamlContent: sandboxState.yamlContent,
          description: sandboxState.description || 'Applied copilot proposal',
          source: 'copilot',
          applyAutoLayout: true,
          createCheckpoint: true, // Always create checkpoints for copilot changes
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || `Failed to apply workflow: ${response.statusText}`)
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.message || 'Failed to apply workflow changes')
      }

      logger.info('Successfully applied sandbox workflow to current workflow', {
        workflowId: activeWorkflowId,
        blocksCount: result.data?.blocksCount,
        edgesCount: result.data?.edgesCount,
      })
    } catch (error) {
      logger.error('Failed to apply sandbox workflow:', error)
      throw error
    } finally {
      setSandboxState((prev) => ({ ...prev, isProcessing: false }))
    }
  }, [activeWorkflowId, sandboxState.yamlContent, sandboxState.description])

  const saveAsNewWorkflow = useCallback(
    async (name: string) => {
      if (!sandboxState.yamlContent) {
        throw new Error('No YAML content to save')
      }

      try {
        setSandboxState((prev) => ({ ...prev, isProcessing: true }))

        logger.info('Creating new workflow from sandbox', {
          name,
          yamlLength: sandboxState.yamlContent.length,
        })

        // First create a new workflow
        const newWorkflowId = await createWorkflow({
          name,
          description: sandboxState.description,
          workspaceId,
        })

        if (!newWorkflowId) {
          throw new Error('Failed to create new workflow')
        }

        // Then apply the YAML content to the new workflow
        const response = await fetch(`/api/workflows/${newWorkflowId}/yaml`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            yamlContent: sandboxState.yamlContent,
            description: sandboxState.description || 'Created from copilot proposal',
            source: 'copilot',
            applyAutoLayout: true,
            createCheckpoint: false, // No need for checkpoint on new workflow
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.message || `Failed to save workflow: ${response.statusText}`)
        }

        const result = await response.json()

        if (!result.success) {
          throw new Error(result.message || 'Failed to save workflow')
        }

        logger.info('Successfully created new workflow from sandbox', {
          newWorkflowId,
          name,
          blocksCount: result.data?.blocksCount,
          edgesCount: result.data?.edgesCount,
        })

        return newWorkflowId
      } catch (error) {
        logger.error('Failed to save sandbox workflow as new:', error)
        throw error
      } finally {
        setSandboxState((prev) => ({ ...prev, isProcessing: false }))
      }
    },
    [sandboxState.yamlContent, sandboxState.description, createWorkflow]
  )

  return {
    sandboxState,
    showSandbox,
    closeSandbox,
    applyToCurrentWorkflow,
    saveAsNewWorkflow,
  }
}
