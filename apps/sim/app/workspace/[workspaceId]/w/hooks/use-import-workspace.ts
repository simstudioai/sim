import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useRouter } from 'next/navigation'
import {
  extractWorkflowName,
  extractWorkflowsFromZip,
  parseWorkflowJson,
  sanitizePathSegment,
} from '@/lib/workflows/operations/import-export'
import { useCreateFolder } from '@/hooks/queries/folders'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'

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
 * @param props - Hook configuration
 * @returns Import workspace handlers and state
 */
export function useImportWorkspace({ onSuccess }: UseImportWorkspaceProps = {}) {
  const router = useRouter()
  const [isImporting, setIsImporting] = useState(false)
  const createFolderMutation = useCreateFolder()
  const clearDiff = useWorkflowDiffStore((state) => state.clearDiff)

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

        const { workflows: extractedWorkflows, metadata } = await extractWorkflowsFromZip(zipFile)

        if (extractedWorkflows.length === 0) {
          logger.warn('No workflows found in ZIP file')
          return
        }

        const workspaceName = metadata?.workspaceName || zipFile.name.replace(/\.zip$/i, '')
        const createResponse = await fetch('/api/workspaces', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: workspaceName, skipDefaultWorkflow: true }),
        })

        if (!createResponse.ok) {
          throw new Error('Failed to create workspace')
        }

        const { workspace: newWorkspace } = await createResponse.json()
        logger.info('Created new workspace:', newWorkspace)

        const folderMap = new Map<string, string>()

        if (metadata?.folders && metadata.folders.length > 0) {
          type ExportedFolder = {
            id: string
            name: string
            parentId: string | null
            sortOrder?: number
          }
          const foldersById = new Map<string, ExportedFolder>(
            metadata.folders.map((f) => [f.id, f])
          )
          const oldIdToNewId = new Map<string, string>()

          const buildPath = (folderId: string): string => {
            const pathParts: string[] = []
            let currentId: string | null = folderId
            while (currentId && foldersById.has(currentId)) {
              const folder: ExportedFolder = foldersById.get(currentId)!
              pathParts.unshift(sanitizePathSegment(folder.name))
              currentId = folder.parentId
            }
            return pathParts.join('/')
          }

          const createFolderRecursive = async (folder: ExportedFolder): Promise<string> => {
            if (oldIdToNewId.has(folder.id)) {
              return oldIdToNewId.get(folder.id)!
            }

            let parentId: string | undefined
            if (folder.parentId && foldersById.has(folder.parentId)) {
              parentId = await createFolderRecursive(foldersById.get(folder.parentId)!)
            }

            const newFolder = await createFolderMutation.mutateAsync({
              name: folder.name,
              workspaceId: newWorkspace.id,
              parentId,
              sortOrder: folder.sortOrder,
            })
            oldIdToNewId.set(folder.id, newFolder.id)
            folderMap.set(buildPath(folder.id), newFolder.id)
            return newFolder.id
          }

          for (const folder of metadata.folders) {
            await createFolderRecursive(folder)
          }
        }

        for (const workflow of extractedWorkflows) {
          try {
            const { data: workflowData, errors: parseErrors } = parseWorkflowJson(workflow.content)

            if (!workflowData || parseErrors.length > 0) {
              logger.warn(`Failed to parse ${workflow.name}:`, parseErrors)
              continue
            }

            let targetFolderId: string | null = null
            if (workflow.folderPath.length > 0) {
              const folderPathKey = workflow.folderPath.join('/')

              if (folderMap.has(folderPathKey)) {
                targetFolderId = folderMap.get(folderPathKey)!
              } else {
                let parentId: string | undefined
                for (let i = 0; i < workflow.folderPath.length; i++) {
                  const pathSegment = workflow.folderPath.slice(0, i + 1).join('/')

                  if (!folderMap.has(pathSegment)) {
                    const subFolder = await createFolderMutation.mutateAsync({
                      name: workflow.folderPath[i],
                      workspaceId: newWorkspace.id,
                      parentId,
                    })
                    folderMap.set(pathSegment, subFolder.id)
                    parentId = subFolder.id
                  } else {
                    parentId = folderMap.get(pathSegment)!
                  }
                }
                targetFolderId = folderMap.get(folderPathKey) || null
              }
            }

            const workflowName = extractWorkflowName(workflow.content, workflow.name)
            clearDiff()

            const workflowColor =
              (workflowData.metadata as { color?: string } | undefined)?.color || '#3972F6'

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

            const stateResponse = await fetch(`/api/workflows/${newWorkflow.id}/state`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(workflowData),
            })

            if (!stateResponse.ok) {
              logger.error(`Failed to save workflow state for ${newWorkflow.id}`)
              continue
            }

            if (workflowData.variables) {
              const variablesArray = Array.isArray(workflowData.variables)
                ? workflowData.variables
                : Object.values(workflowData.variables)

              if (variablesArray.length > 0) {
                const variablesRecord: Record<
                  string,
                  { id: string; workflowId: string; name: string; type: string; value: unknown }
                > = {}

                for (const v of variablesArray) {
                  const id = typeof v.id === 'string' && v.id.trim() ? v.id : crypto.randomUUID()
                  variablesRecord[id] = {
                    id,
                    workflowId: newWorkflow.id,
                    name: v.name,
                    type: v.type,
                    value: v.value,
                  }
                }

                const variablesResponse = await fetch(
                  `/api/workflows/${newWorkflow.id}/variables`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ variables: variablesRecord }),
                  }
                )

                if (!variablesResponse.ok) {
                  logger.error(`Failed to save variables for ${newWorkflow.id}`)
                }
              }
            }

            logger.info(`Imported workflow: ${workflowName}`)
          } catch (error) {
            logger.error(`Failed to import ${workflow.name}:`, error)
          }
        }

        logger.info(`Workspace import complete. Imported ${extractedWorkflows.length} workflows`)

        router.push(`/workspace/${newWorkspace.id}/w`)

        onSuccess?.()
      } catch (error) {
        logger.error('Error importing workspace:', error)
        throw error
      } finally {
        setIsImporting(false)
      }
    },
    [isImporting, router, onSuccess, createFolderMutation, clearDiff]
  )

  return {
    isImporting,
    handleImportWorkspace,
  }
}
