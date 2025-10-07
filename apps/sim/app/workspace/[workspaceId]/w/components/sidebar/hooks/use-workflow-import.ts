import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { parseWorkflowJson } from '@/stores/workflows/json/importer'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('useWorkflowImport')

interface UseWorkflowImportProps {
  workspaceId: string
}

/**
 * Custom hook to handle workflow JSON import functionality.
 * Manages file reading, JSON parsing, workflow creation, and state initialization.
 *
 * @param props - Configuration object containing workspaceId
 * @returns Import state and handlers
 */
export function useWorkflowImport({ workspaceId }: UseWorkflowImportProps) {
  const router = useRouter()
  const { createWorkflow } = useWorkflowRegistry()
  const [isImporting, setIsImporting] = useState(false)

  /**
   * Handle direct import of workflow JSON
   */
  const handleDirectImport = useCallback(
    async (content: string, filename?: string) => {
      if (!content.trim()) {
        logger.error('JSON content is required')
        return
      }

      setIsImporting(true)

      try {
        // First validate the JSON without importing
        const { data: workflowData, errors: parseErrors } = parseWorkflowJson(content)

        if (!workflowData || parseErrors.length > 0) {
          logger.error('Failed to parse JSON:', { errors: parseErrors })
          return
        }

        // Generate workflow name from filename or fallback to time-based name
        const getWorkflowName = () => {
          if (filename) {
            // Remove file extension and use the filename
            const nameWithoutExtension = filename.replace(/\.json$/i, '')
            return (
              nameWithoutExtension.trim() || `Imported Workflow - ${new Date().toLocaleString()}`
            )
          }
          return `Imported Workflow - ${new Date().toLocaleString()}`
        }

        // Clear workflow diff store when creating a new workflow from import
        const { clearDiff } = useWorkflowDiffStore.getState()
        clearDiff()

        // Create a new workflow
        const newWorkflowId = await createWorkflow({
          name: getWorkflowName(),
          description: 'Workflow imported from JSON',
          workspaceId,
        })

        // Set the workflow as active in the registry to prevent reload
        useWorkflowRegistry.setState({ activeWorkflowId: newWorkflowId })

        // Cast the workflow data to WorkflowState type
        const typedWorkflowData = workflowData as unknown as WorkflowState

        // Set the workflow state immediately (optimistic update)
        useWorkflowStore.setState({
          blocks: typedWorkflowData.blocks,
          edges: typedWorkflowData.edges,
          loops: typedWorkflowData.loops,
          parallels: typedWorkflowData.parallels,
          lastSaved: Date.now(),
        })

        // Initialize subblock store with the imported blocks
        useSubBlockStore.getState().initializeFromWorkflow(newWorkflowId, typedWorkflowData.blocks)

        // Set subblock values if they exist in the imported data
        const subBlockStore = useSubBlockStore.getState()
        for (const [blockId, block] of Object.entries(typedWorkflowData.blocks)) {
          if (block.subBlocks) {
            for (const [subBlockId, subBlock] of Object.entries(block.subBlocks)) {
              if (subBlock.value !== null && subBlock.value !== undefined) {
                subBlockStore.setValue(blockId, subBlockId, subBlock.value)
              }
            }
          }
        }

        // Navigate to the new workflow after setting state
        router.push(`/workspace/${workspaceId}/w/${newWorkflowId}`)

        logger.info('Workflow imported successfully from JSON')

        // Persist to database in the background
        fetch(`/api/workflows/${newWorkflowId}/state`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(workflowData),
        })
          .then((response) => {
            if (!response.ok) {
              logger.error('Failed to persist imported workflow to database')
            } else {
              logger.info('Imported workflow persisted to database')
            }
          })
          .catch((error) => {
            logger.error('Failed to persist imported workflow:', error)
          })
      } catch (error) {
        logger.error('Failed to import workflow:', { error })
      } finally {
        setIsImporting(false)
      }
    },
    [createWorkflow, workspaceId, router]
  )

  /**
   * Handle file selection and read
   */
  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      try {
        const content = await file.text()

        // Import directly with filename
        await handleDirectImport(content, file.name)
      } catch (error) {
        logger.error('Failed to read file:', { error })
      }

      // Reset file input
      const input = event.target
      if (input) {
        input.value = ''
      }
    },
    [handleDirectImport]
  )

  return {
    isImporting,
    handleDirectImport,
    handleFileChange,
  }
}
