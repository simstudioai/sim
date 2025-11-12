import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import { extractWorkflowName, extractWorkflowsFromZip } from '@/lib/workflows/import-export'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { parseWorkflowJson } from '@/stores/workflows/json/importer'

const logger = createLogger('useImportWorkspace')

interface UseImportWorkspaceProps {
  /**
   * Optional callback after successful import
   */
  onSuccess?: () => void
}

/**
 * Hook for managing workspace import from ZIP files.
 *
 * Handles:
 * - Extracting workflows from ZIP file
 * - Creating new workspace
 * - Recreating folder structure
 * - Importing all workflows with states and variables
 * - Navigation to imported workspace
 * - Loading state management
 * - Error handling and logging
 *
 * @param props - Hook configuration
 * @returns Import workspace handlers and state
 */
export function useImportWorkspace({ onSuccess }: UseImportWorkspaceProps = {}) {
  const router = useRouter()
  const [isImporting, setIsImporting] = useState(false)

  /**
   * Handle workspace import from ZIP file
   */
  const handleImportWorkspace = useCallback(
    async (zipFile: File) => {
      if (isImporting) {
        return
      }

      if (!zipFile.name.toLowerCase().endsWith('.zip')) {
        logger.error('Please select a ZIP file')
        return
      }

      setIsImporting(true)
      try {
        logger.info('Importing workspace from ZIP')

        // Extract workflows from ZIP
        const { workflows: extractedWorkflows, metadata } = await extractWorkflowsFromZip(zipFile)

        if (extractedWorkflows.length === 0) {
          logger.warn('No workflows found in ZIP file')
          return
        }

        // Create new workspace
        const workspaceName = metadata?.workspaceName || zipFile.name.replace(/\.zip$/i, '')
        const createResponse = await fetch('/api/workspaces', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: workspaceName }),
        })

        if (!createResponse.ok) {
          throw new Error('Failed to create workspace')
        }

        const { workspace: newWorkspace } = await createResponse.json()
        logger.info('Created new workspace:', newWorkspace)

        const { createFolder } = useFolderStore.getState()
        const folderMap = new Map<string, string>()

        // Import workflows
        for (const workflow of extractedWorkflows) {
          try {
            const { data: workflowData, errors: parseErrors } = parseWorkflowJson(workflow.content)

            if (!workflowData || parseErrors.length > 0) {
              logger.warn(`Failed to parse ${workflow.name}:`, parseErrors)
              continue
            }

            // Recreate folder structure
            let targetFolderId: string | null = null
            if (workflow.folderPath.length > 0) {
              const folderPathKey = workflow.folderPath.join('/')

              if (!folderMap.has(folderPathKey)) {
                let parentId: string | null = null

                for (let i = 0; i < workflow.folderPath.length; i++) {
                  const pathSegment = workflow.folderPath.slice(0, i + 1).join('/')

                  if (!folderMap.has(pathSegment)) {
                    const subFolder = await createFolder({
                      name: workflow.folderPath[i],
                      workspaceId: newWorkspace.id,
                      parentId: parentId || undefined,
                    })
                    folderMap.set(pathSegment, subFolder.id)
                    parentId = subFolder.id
                  } else {
                    parentId = folderMap.get(pathSegment)!
                  }
                }
              }

              targetFolderId = folderMap.get(folderPathKey) || null
            }

            const workflowName = extractWorkflowName(workflow.content, workflow.name)
            useWorkflowDiffStore.getState().clearDiff()

            // Extract color from workflow metadata
            const parsedContent = JSON.parse(workflow.content)
            const workflowColor =
              parsedContent.state?.metadata?.color || parsedContent.metadata?.color || '#3972F6'

            // Create workflow
            const createWorkflowResponse = await fetch('/api/workflows', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: workflowName,
                description: workflowData.metadata?.description || 'Imported from workspace export',
                color: workflowColor,
                workspaceId: newWorkspace.id,
                folderId: targetFolderId,
              }),
            })

            if (!createWorkflowResponse.ok) {
              logger.error(`Failed to create workflow ${workflowName}`)
              continue
            }

            const newWorkflow = await createWorkflowResponse.json()

            // Save workflow state
            const stateResponse = await fetch(`/api/workflows/${newWorkflow.id}/state`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(workflowData),
            })

            if (!stateResponse.ok) {
              logger.error(`Failed to save workflow state for ${newWorkflow.id}`)
              continue
            }

            // Save variables if any
            if (workflowData.variables && workflowData.variables.length > 0) {
              const variablesPayload = workflowData.variables.map((v: any) => ({
                id: typeof v.id === 'string' && v.id.trim() ? v.id : crypto.randomUUID(),
                workflowId: newWorkflow.id,
                name: v.name,
                type: v.type,
                value: v.value,
              }))

              await fetch(`/api/workflows/${newWorkflow.id}/variables`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ variables: variablesPayload }),
              })
            }

            logger.info(`Imported workflow: ${workflowName}`)
          } catch (error) {
            logger.error(`Failed to import ${workflow.name}:`, error)
          }
        }

        logger.info(`Workspace import complete. Imported ${extractedWorkflows.length} workflows`)

        // Navigate to new workspace
        router.push(`/workspace/${newWorkspace.id}/w`)

        onSuccess?.()
      } catch (error) {
        logger.error('Error importing workspace:', error)
        throw error
      } finally {
        setIsImporting(false)
      }
    },
    [isImporting, router, onSuccess]
  )

  return {
    isImporting,
    handleImportWorkspace,
  }
}
