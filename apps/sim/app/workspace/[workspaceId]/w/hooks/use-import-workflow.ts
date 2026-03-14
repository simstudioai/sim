import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import {
  extractWorkflowsFromFiles,
  extractWorkflowsFromZip,
  persistImportedWorkflow,
  sanitizePathSegment,
} from '@/lib/workflows/operations/import-export'
import { folderKeys, useCreateFolder } from '@/hooks/queries/folders'
import { useCreateWorkflow, workflowKeys } from '@/hooks/queries/workflows'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'

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
  const createWorkflowMutation = useCreateWorkflow()
  const queryClient = useQueryClient()
  const createFolderMutation = useCreateFolder()
  const clearDiff = useWorkflowDiffStore((state) => state.clearDiff)
  const [isImporting, setIsImporting] = useState(false)

  /**
   * Import a single workflow
   */
  const importSingleWorkflow = useCallback(
    async (content: string, filename: string, folderId?: string, sortOrder?: number) => {
      clearDiff()
      const result = await persistImportedWorkflow({
        content,
        filename,
        workspaceId,
        folderId,
        sortOrder,
        createWorkflow: async ({ name, description, color, workspaceId, folderId, sortOrder }) =>
          createWorkflowMutation.mutateAsync({
            name,
            description,
            color,
            workspaceId,
            folderId,
            sortOrder,
          }),
      })

      return result?.workflowId ?? null
    },
    [clearDiff, createWorkflowMutation, workspaceId]
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
          const zipFile = fileArray[0]
          const { workflows: extractedWorkflows, metadata } = await extractWorkflowsFromZip(zipFile)

          const folderName = metadata?.workspaceName || zipFile.name.replace(/\.zip$/i, '')
          const importFolder = await createFolderMutation.mutateAsync({
            name: folderName,
            workspaceId,
          })
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

              let parentId = importFolder.id
              if (folder.parentId && foldersById.has(folder.parentId)) {
                parentId = await createFolderRecursive(foldersById.get(folder.parentId)!)
              }

              const newFolder = await createFolderMutation.mutateAsync({
                name: folder.name,
                workspaceId,
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
              let targetFolderId = importFolder.id

              if (workflow.folderPath.length > 0) {
                const folderPathKey = workflow.folderPath.join('/')

                if (folderMap.has(folderPathKey)) {
                  targetFolderId = folderMap.get(folderPathKey)!
                } else {
                  let parentId = importFolder.id
                  for (let i = 0; i < workflow.folderPath.length; i++) {
                    const pathSegment = workflow.folderPath.slice(0, i + 1).join('/')
                    const folderNameForSegment = workflow.folderPath[i]

                    if (!folderMap.has(pathSegment)) {
                      const subFolder = await createFolderMutation.mutateAsync({
                        name: folderNameForSegment,
                        workspaceId,
                        parentId,
                      })
                      folderMap.set(pathSegment, subFolder.id)
                      parentId = subFolder.id
                    } else {
                      parentId = folderMap.get(pathSegment)!
                    }
                  }
                  targetFolderId = folderMap.get(folderPathKey)!
                }
              }

              const workflowId = await importSingleWorkflow(
                workflow.content,
                workflow.name,
                targetFolderId,
                workflow.sortOrder
              )
              if (workflowId) importedWorkflowIds.push(workflowId)
            } catch (error) {
              logger.error(`Failed to import ${workflow.name}:`, error)
            }
          }
        } else if (jsonFiles.length > 0) {
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

        await queryClient.invalidateQueries({ queryKey: workflowKeys.lists() })
        await queryClient.invalidateQueries({ queryKey: folderKeys.list(workspaceId) })

        logger.info(`Import complete. Imported ${importedWorkflowIds.length} workflow(s)`)

        if (importedWorkflowIds.length > 0) {
          router.push(
            `/workspace/${workspaceId}/w/${importedWorkflowIds[importedWorkflowIds.length - 1]}`
          )
        }
      } catch (error) {
        logger.error('Failed to import workflows:', error)
      } finally {
        setIsImporting(false)

        if (event.target) {
          event.target.value = ''
        }
      }
    },
    [importSingleWorkflow, workspaceId, router, createFolderMutation, queryClient]
  )

  return {
    isImporting,
    handleFileChange,
  }
}
