import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import {
  extractWorkflowName,
  extractWorkflowsFromFiles,
  extractWorkflowsFromZip,
} from '@/lib/workflows/import-export'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { parseWorkflowJson } from '@/stores/workflows/json/importer'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('useImportWorkflow')

interface UseImportWorkflowProps {
  workspaceId: string
}

/**
 * Custom hook to handle workflow import functionality.
 * Supports importing from:
 * - Single JSON file
 * - Multiple JSON files
 * - ZIP file containing multiple workflows with folder structure
 *
 * @param props - Configuration object containing workspaceId
 * @returns Import state and handlers
 */
export function useImportWorkflow({ workspaceId }: UseImportWorkflowProps) {
  const router = useRouter()
  const { createWorkflow, loadWorkflows } = useWorkflowRegistry()
  const [isImporting, setIsImporting] = useState(false)

  /**
   * Import a single workflow
   */
  const importSingleWorkflow = useCallback(
    async (content: string, filename: string, folderId?: string) => {
      const { data: workflowData, errors: parseErrors } = parseWorkflowJson(content)

      if (!workflowData || parseErrors.length > 0) {
        logger.warn(`Failed to parse ${filename}:`, parseErrors)
        return null
      }

      const workflowName = extractWorkflowName(content, filename)
      useWorkflowDiffStore.getState().clearDiff()

      // Extract color from metadata
      const parsedContent = JSON.parse(content)
      const workflowColor =
        parsedContent.state?.metadata?.color || parsedContent.metadata?.color || '#3972F6'

      const newWorkflowId = await createWorkflow({
        name: workflowName,
        description: workflowData.metadata?.description || 'Imported from JSON',
        workspaceId,
        folderId: folderId || undefined,
      })

      // Update workflow color if we extracted one
      if (workflowColor !== '#3972F6') {
        await fetch(`/api/workflows/${newWorkflowId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ color: workflowColor }),
        })
      }

      // Save workflow state
      await fetch(`/api/workflows/${newWorkflowId}/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflowData),
      })

      // Save variables if any
      if (workflowData.variables && workflowData.variables.length > 0) {
        const variablesPayload = workflowData.variables.map((v: any) => ({
          id: typeof v.id === 'string' && v.id.trim() ? v.id : crypto.randomUUID(),
          workflowId: newWorkflowId,
          name: v.name,
          type: v.type,
          value: v.value,
        }))

        await fetch(`/api/workflows/${newWorkflowId}/variables`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variables: variablesPayload }),
        })
      }

      logger.info(`Imported workflow: ${workflowName}`)
      return newWorkflowId
    },
    [createWorkflow, workspaceId]
  )

  /**
   * Handle file selection and read
   */
  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files
      if (!files || files.length === 0) return

      setIsImporting(true)
      try {
        const fileArray = Array.from(files)
        const hasZip = fileArray.some((f) => f.name.toLowerCase().endsWith('.zip'))
        const jsonFiles = fileArray.filter((f) => f.name.toLowerCase().endsWith('.json'))

        const importedWorkflowIds: string[] = []

        if (hasZip && fileArray.length === 1) {
          // Import from ZIP - preserves folder structure
          const zipFile = fileArray[0]
          const { workflows: extractedWorkflows, metadata } = await extractWorkflowsFromZip(zipFile)

          const { createFolder } = useFolderStore.getState()
          const folderName = metadata?.workspaceName || zipFile.name.replace(/\.zip$/i, '')
          const importFolder = await createFolder({ name: folderName, workspaceId })
          const folderMap = new Map<string, string>()

          for (const workflow of extractedWorkflows) {
            try {
              let targetFolderId = importFolder.id

              // Recreate nested folder structure
              if (workflow.folderPath.length > 0) {
                const folderPathKey = workflow.folderPath.join('/')

                if (!folderMap.has(folderPathKey)) {
                  let parentId = importFolder.id

                  for (let i = 0; i < workflow.folderPath.length; i++) {
                    const pathSegment = workflow.folderPath.slice(0, i + 1).join('/')

                    if (!folderMap.has(pathSegment)) {
                      const subFolder = await createFolder({
                        name: workflow.folderPath[i],
                        workspaceId,
                        parentId,
                      })
                      folderMap.set(pathSegment, subFolder.id)
                      parentId = subFolder.id
                    } else {
                      parentId = folderMap.get(pathSegment)!
                    }
                  }
                }

                targetFolderId = folderMap.get(folderPathKey)!
              }

              const workflowId = await importSingleWorkflow(
                workflow.content,
                workflow.name,
                targetFolderId
              )
              if (workflowId) importedWorkflowIds.push(workflowId)
            } catch (error) {
              logger.error(`Failed to import ${workflow.name}:`, error)
            }
          }
        } else if (jsonFiles.length > 0) {
          // Import multiple JSON files or single JSON
          const extractedWorkflows = await extractWorkflowsFromFiles(jsonFiles)

          for (const workflow of extractedWorkflows) {
            try {
              const workflowId = await importSingleWorkflow(workflow.content, workflow.name)
              if (workflowId) importedWorkflowIds.push(workflowId)
            } catch (error) {
              logger.error(`Failed to import ${workflow.name}:`, error)
            }
          }
        }

        // Reload workflows to show newly imported ones
        await loadWorkflows(workspaceId)
        await useFolderStore.getState().fetchFolders(workspaceId)

        logger.info(`Import complete. Imported ${importedWorkflowIds.length} workflow(s)`)

        // Navigate to first imported workflow if any
        if (importedWorkflowIds.length > 0) {
          router.push(`/workspace/${workspaceId}/w/${importedWorkflowIds[0]}`)
        }
      } catch (error) {
        logger.error('Failed to import workflows:', error)
      } finally {
        setIsImporting(false)

        // Reset file input
        if (event.target) {
          event.target.value = ''
        }
      }
    },
    [importSingleWorkflow, workspaceId, loadWorkflows, router]
  )

  return {
    isImporting,
    handleFileChange,
  }
}
