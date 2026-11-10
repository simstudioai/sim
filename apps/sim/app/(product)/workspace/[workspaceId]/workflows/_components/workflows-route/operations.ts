'use client'

import { type ChangeEvent, useCallback, useRef, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { compareStrings } from '@sim/utils/string'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { workspacePath } from '@/lib/navigation/paths'
import { toast } from '@/lib/toast/sink'
import {
  useCreateFolder,
  useDuplicateFolderMutation,
  useReorderFolders,
} from '@/platform/lib/data/folders'
import {
  captureEvent,
  createLogger,
  downloadFile,
  exportFolderToZip,
  extractWorkflowsFromFiles,
  extractWorkflowsFromZip,
  type FolderExportData,
  fetchWorkflowForExport,
  folderKeys,
  generateCreativeWorkflowName,
  generateFolderName,
  generateSubfolderName,
  getFolderMap,
  getWorkflows,
  invalidateWorkflowLists,
  persistImportedWorkflow,
  sanitizePathSegment,
  useCreateWorkflow,
  useDuplicateWorkflowMutation,
  useReorderWorkflows,
  useWorkflowRegistry,
  type WorkflowExportData,
  type WorkflowFolder,
  type WorkflowMetadata,
} from '@/platform/lib/data/workflows'
import { usePlatformHref } from '@/platform/lib/navigation'

const logger = createLogger('WorkflowListOperations')

/** The editor route of one workflow. */
export function workflowEditorPath(workspaceId: string, workflowId: string) {
  return `${workspacePath(workspaceId, 'workflows')}/${encodeURIComponent(workflowId)}`
}

/** One sibling slot in a folder: folders and workflows share one ordering. */
interface SiblingItem {
  type: 'folder' | 'workflow'
  id: string
  sortOrder: number
  createdAt: Date
}

/** The sidebar's order: sort order, then age, then id, so ties never reshuffle. */
function compareByOrder(a: SiblingItem, b: SiblingItem) {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
  const timeA = a.createdAt.getTime()
  const timeB = b.createdAt.getTime()
  if (timeA !== timeB) return timeA - timeB
  return compareStrings(a.id, b.id)
}

/** A reorder that did not fully commit; whether it was partial picks the message. */
class ReorderFailedError extends Error {
  readonly partial: boolean

  constructor(partial: boolean, causes: unknown[]) {
    super(partial ? 'Reorder partially failed' : 'Reorder failed', { cause: causes })
    this.name = 'ReorderFailedError'
    this.partial = partial
  }
}

/** Every workflow inside a folder and its subfolders, with the folder each sits in. */
function collectWorkflowsInFolder(
  folderId: string,
  workflows: readonly WorkflowMetadata[],
  folders: Record<string, WorkflowFolder>
): { id: string; folderId: string | null }[] {
  const collected: { id: string; folderId: string | null }[] = []
  for (const workflow of workflows) {
    if (workflow.folderId === folderId)
      collected.push({ id: workflow.id, folderId: workflow.folderId ?? null })
  }
  for (const folder of Object.values(folders)) {
    if (folder.parentId === folderId)
      collected.push(...collectWorkflowsInFolder(folder.id, workflows, folders))
  }
  return collected
}

/** A folder's subfolders, with its direct children made top-level, as the export expects. */
function collectSubfolders(
  rootFolderId: string,
  folders: Record<string, WorkflowFolder>
): FolderExportData[] {
  const subfolders: FolderExportData[] = []
  const collect = (parentId: string) => {
    for (const folder of Object.values(folders)) {
      if (folder.parentId !== parentId) continue
      subfolders.push({
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId === rootFolderId ? null : folder.parentId,
      })
      collect(folder.id)
    }
  }
  collect(rootFolderId)
  return subfolders
}

/** The first `Name Copy`, `Name Copy 2`, … that no sibling folder already uses. */
function duplicateFolderName(baseName: string, siblingNames: ReadonlySet<string>) {
  const trimmedName = (baseName || 'Untitled Folder').trim()
  let candidate = `${trimmedName} Copy`
  let counter = 2
  while (siblingNames.has(candidate)) {
    candidate = `${trimmedName} Copy ${counter}`
    counter += 1
  }
  return candidate
}

/**
 * The Workflows list's commands, each opening the workspace's own editor: creating a workflow or
 * folder, duplicating, exporting a folder, importing JSON or ZIP files, and moving rows into a
 * folder.
 */
export function useWorkflowListOperations(workspaceId: string) {
  const router = useRouter()
  const hrefFor = usePlatformHref()
  const queryClient = useQueryClient()
  const posthog = usePostHog()
  const posthogRef = useRef(posthog)
  posthogRef.current = posthog

  const createWorkflowMutation = useCreateWorkflow()
  const createWorkflowMutate = createWorkflowMutation.mutate
  const createWorkflowAsync = createWorkflowMutation.mutateAsync
  const createFolderMutation = useCreateFolder()
  const createFolderAsync = createFolderMutation.mutateAsync
  const duplicateWorkflowAsync = useDuplicateWorkflowMutation().mutateAsync
  const duplicateFolderAsync = useDuplicateFolderMutation().mutateAsync
  const reorderWorkflows = useReorderWorkflows().mutateAsync
  const reorderFolders = useReorderFolders().mutateAsync

  const [isDuplicating, setIsDuplicating] = useState(false)
  const [exportingFolderId, setExportingFolderId] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const busy = useRef({ duplicating: false, exporting: false })

  const openWorkflow = useCallback(
    (workflowId: string) => router.push(hrefFor(workflowEditorPath(workspaceId, workflowId))),
    [router, hrefFor, workspaceId]
  )

  /**
   * A new workflow named like legacy's, created optimistically and opened at once: the editor
   * waits on the registry's creating mark until the server confirms it.
   */
  const createWorkflow = useCallback(
    (folderId: string | null) => {
      const name = generateCreativeWorkflowName()
      const id = generateId()
      createWorkflowMutate({
        workspaceId,
        ...(folderId ? { folderId } : {}),
        name,
        id,
        deduplicate: true,
      })
      useWorkflowRegistry.getState().markWorkflowCreating(id)
      openWorkflow(id)
    },
    [createWorkflowMutate, openWorkflow, workspaceId]
  )

  /**
   * A new folder under `parentId`, named `Folder n` at the root or `Subfolder n` inside a folder
   * from the server's current list, since the unique index refuses a duplicate name.
   */
  const createFolder = useCallback(
    async (parentId: string | null): Promise<WorkflowFolder | null> => {
      try {
        const name = parentId
          ? await generateSubfolderName(workspaceId, parentId)
          : await generateFolderName(workspaceId)
        const folder = await createFolderAsync({
          workspaceId,
          name,
          ...(parentId ? { parentId } : {}),
          id: generateId(),
        })
        logger.info('Created folder', { folderId: folder.id })
        return folder
      } catch (error) {
        logger.error('Failed to create folder', { error })
        toast.error(getErrorMessage(error, 'Failed to create folder'))
        return null
      }
    },
    [createFolderAsync, workspaceId]
  )

  /**
   * Copies folders (with their workflows) beside themselves, then workflows into their own
   * folders. A single workflow copy opens in the editor.
   */
  const duplicate = useCallback(
    async (workflowIds: readonly string[], folderIds: readonly string[]) => {
      if (busy.current.duplicating) return
      if (workflowIds.length === 0 && folderIds.length === 0) return
      busy.current.duplicating = true
      setIsDuplicating(true)
      try {
        const workflowMap = new Map(getWorkflows(workspaceId).map((w) => [w.id, w]))
        const folderMap = getFolderMap(workspaceId)
        const duplicatedWorkflowIds: string[] = []
        const duplicatedFolderIds: string[] = []

        for (const folderId of folderIds) {
          const folder = folderMap[folderId]
          if (!folder) {
            logger.warn('Folder not found, skipping', { folderId })
            continue
          }
          const siblingNames = new Set(
            Object.values(folderMap)
              .filter((sibling) => sibling.parentId === folder.parentId)
              .map((sibling) => sibling.name)
          )
          siblingNames.add(folder.name)
          const result = await duplicateFolderAsync({
            id: folderId,
            workspaceId,
            name: duplicateFolderName(folder.name, siblingNames),
            parentId: folder.parentId,
            newId: generateId(),
          })
          if (result?.id) duplicatedFolderIds.push(result.id)
        }

        for (const workflowId of workflowIds) {
          const workflow = workflowMap.get(workflowId)
          if (!workflow) {
            logger.warn('Workflow not found, skipping', { workflowId })
            continue
          }
          const result = await duplicateWorkflowAsync({
            workspaceId,
            sourceId: workflowId,
            name: `${workflow.name} (Copy)`,
            description: workflow.description,
            folderId: workflow.folderId,
            newId: generateId(),
          })
          duplicatedWorkflowIds.push(result.id)
        }

        logger.info('Selection duplicated', {
          workflowCount: duplicatedWorkflowIds.length,
          folderCount: duplicatedFolderIds.length,
        })
        if (duplicatedWorkflowIds.length === 1 && duplicatedFolderIds.length === 0)
          openWorkflow(duplicatedWorkflowIds[0])
      } catch (error) {
        logger.error('Error duplicating selection', { error })
        toast.error(getErrorMessage(error, 'Failed to duplicate'))
      } finally {
        busy.current.duplicating = false
        setIsDuplicating(false)
      }
    },
    [duplicateFolderAsync, duplicateWorkflowAsync, openWorkflow, workspaceId]
  )

  /** One folder's workflows and subfolders as `<folder>-export.zip`, paths kept relative to it. */
  const exportFolder = useCallback(
    async (folderId: string) => {
      if (busy.current.exporting) return
      busy.current.exporting = true
      setExportingFolderId(folderId)
      try {
        const folders = getFolderMap(workspaceId)
        const workflows = getWorkflows(workspaceId)
        const folder = folders[folderId]
        if (!folder) {
          logger.warn('Folder not found for export', { folderId })
          return
        }
        const workflowsToExport = collectWorkflowsInFolder(folderId, workflows, folders)
        if (workflowsToExport.length === 0) {
          logger.warn('No workflows found in folder to export', { folderId })
          return
        }
        const subfolders = collectSubfolders(folderId, folders)
        const workflowById = new Map(workflows.map((w) => [w.id, w]))
        const workflowExportData: WorkflowExportData[] = []
        for (const collected of workflowsToExport) {
          const workflowMeta = workflowById.get(collected.id)
          if (!workflowMeta) continue
          const exportData = await fetchWorkflowForExport(collected.id, {
            name: workflowMeta.name,
            description: workflowMeta.description,
            folderId: collected.folderId === folderId ? null : collected.folderId,
          })
          if (exportData) workflowExportData.push(exportData)
        }
        if (workflowExportData.length === 0) {
          logger.warn('No workflows were prepared for export', { folderId })
          return
        }
        const zipBlob = await exportFolderToZip(folder.name, workflowExportData, subfolders)
        downloadFile(zipBlob, `${sanitizePathSegment(folder.name)}-export.zip`, 'application/zip')
        logger.info('Folder exported', { folderId, workflowCount: workflowExportData.length })
      } catch (error) {
        logger.error('Error exporting folder', { error })
        toast.error(getErrorMessage(error, 'Failed to export folder'))
      } finally {
        busy.current.exporting = false
        setExportingFolderId(null)
      }
    },
    [workspaceId]
  )

  const importSingleWorkflow = useCallback(
    async (content: string, filename: string, folderId?: string, sortOrder?: number) => {
      const result = await persistImportedWorkflow({
        content,
        filename,
        workspaceId,
        folderId,
        sortOrder,
        createWorkflow: (input) =>
          createWorkflowAsync({
            name: input.name,
            description: input.description,
            workspaceId: input.workspaceId,
            folderId: input.folderId,
            sortOrder: input.sortOrder,
            deduplicate: true,
          }),
      })
      if (!result) throw new Error('The file does not contain valid workflow JSON.')
      return result.workflowId
    },
    [createWorkflowAsync, workspaceId]
  )

  /**
   * Imports the chosen files into `targetFolderId` (the root when `null`): one or more JSON
   * workflows, or one ZIP whose folders are recreated inside a new folder named after it. The
   * last imported workflow opens in the editor.
   */
  const importFiles = useCallback(
    async (event: ChangeEvent<HTMLInputElement>, targetFolderId: string | null) => {
      const input = event.currentTarget
      const files = input.files
      if (!files || files.length === 0) return
      const fileArray = Array.from(files)
      input.value = ''
      setIsImporting(true)
      try {
        const hasZip = fileArray.some((file) => file.name.toLowerCase().endsWith('.zip'))
        const jsonFiles = fileArray.filter((file) => file.name.toLowerCase().endsWith('.json'))
        const importedWorkflowIds: string[] = []
        const parent = targetFolderId ?? undefined

        if (hasZip && fileArray.length === 1) {
          const zipFile = fileArray[0]
          const { workflows: extractedWorkflows, metadata } = await extractWorkflowsFromZip(
            zipFile
          ).catch((error: unknown) => {
            throw new Error('Failed to import ZIP file. Check that it is a valid ZIP archive.', {
              cause: error,
            })
          })

          const importFolder = await createFolderAsync({
            name: metadata?.workspaceName || zipFile.name.replace(/\.zip$/i, ''),
            workspaceId,
            ...(parent ? { parentId: parent } : {}),
          })
          const folderByPath = new Map<string, string>()

          const exportedFolders = metadata?.folders ?? []
          if (exportedFolders.length > 0) {
            const foldersById = new Map(exportedFolders.map((folder) => [folder.id, folder]))
            const newIdByOldId = new Map<string, string>()

            const buildPath = (folderId: string) => {
              const parts: string[] = []
              const seen = new Set<string>()
              let current = foldersById.get(folderId)
              while (current && !seen.has(current.id)) {
                seen.add(current.id)
                parts.unshift(sanitizePathSegment(current.name))
                current = current.parentId ? foldersById.get(current.parentId) : undefined
              }
              return parts.join('/')
            }

            const createFolderRecursive = async (
              folder: (typeof exportedFolders)[number]
            ): Promise<string> => {
              const existing = newIdByOldId.get(folder.id)
              if (existing) return existing
              const exportedParent = folder.parentId ? foldersById.get(folder.parentId) : undefined
              const parentId = exportedParent
                ? await createFolderRecursive(exportedParent)
                : importFolder.id
              const created = await createFolderAsync({
                name: folder.name,
                workspaceId,
                parentId,
                sortOrder: folder.sortOrder,
              })
              newIdByOldId.set(folder.id, created.id)
              folderByPath.set(buildPath(folder.id), created.id)
              return created.id
            }

            for (const folder of exportedFolders) await createFolderRecursive(folder)
          }

          for (const workflow of extractedWorkflows) {
            try {
              let targetFolder = importFolder.id
              if (workflow.folderPath.length > 0) {
                const folderPathKey = workflow.folderPath.join('/')
                const known = folderByPath.get(folderPathKey)
                if (known) {
                  targetFolder = known
                } else {
                  let parentId = importFolder.id
                  for (let i = 0; i < workflow.folderPath.length; i++) {
                    const pathSegment = workflow.folderPath.slice(0, i + 1).join('/')
                    const existing = folderByPath.get(pathSegment)
                    if (existing) {
                      parentId = existing
                      continue
                    }
                    const subFolder = await createFolderAsync({
                      name: workflow.folderPath[i],
                      workspaceId,
                      parentId,
                    })
                    folderByPath.set(pathSegment, subFolder.id)
                    parentId = subFolder.id
                  }
                  targetFolder = parentId
                }
              }
              const workflowId = await importSingleWorkflow(
                workflow.content,
                workflow.name,
                targetFolder,
                workflow.sortOrder
              )
              if (workflowId) importedWorkflowIds.push(workflowId)
            } catch (error) {
              logger.error('Failed to import workflow', { name: workflow.name, error })
              toast.error(`Failed to import ${workflow.name}`, {
                description: getErrorMessage(error, 'Workflow import failed'),
              })
            }
          }
        } else if (jsonFiles.length > 0) {
          const extractedWorkflows = await extractWorkflowsFromFiles(jsonFiles)
          for (const workflow of extractedWorkflows) {
            try {
              const workflowId = await importSingleWorkflow(workflow.content, workflow.name, parent)
              if (workflowId) importedWorkflowIds.push(workflowId)
            } catch (error) {
              logger.error('Failed to import workflow', { name: workflow.name, error })
              toast.error(`Failed to import ${workflow.name}`, {
                description: getErrorMessage(error, 'Workflow import failed'),
              })
            }
          }
        }

        await invalidateWorkflowLists(queryClient, workspaceId)
        await queryClient.invalidateQueries({ queryKey: folderKeys.list(workspaceId) })
        logger.info('Import complete', { count: importedWorkflowIds.length })

        const lastImported = importedWorkflowIds.at(-1)
        if (lastImported) {
          captureEvent(posthogRef.current, 'workflow_imported', {
            workspace_id: workspaceId,
            workflow_count: importedWorkflowIds.length,
            format: hasZip && fileArray.length === 1 ? 'zip' : 'json',
          })
          openWorkflow(lastImported)
        }
      } catch (error) {
        logger.error('Failed to import workflows', { error })
        toast.error(getErrorMessage(error, 'Failed to import workflows'))
      } finally {
        setIsImporting(false)
      }
    },
    [createFolderAsync, importSingleWorkflow, openWorkflow, queryClient, workspaceId]
  )

  /**
   * Moves workflows and folders into `destination` (the root when `null`), appended after its
   * current children in the shared order, as a sidebar drop "inside" a folder does. Folders and
   * workflows commit through separate endpoints, so a half-applied move says so.
   */
  const moveInto = useCallback(
    async (
      workflowIds: readonly string[],
      folderIds: readonly string[],
      destination: string | null
    ) => {
      if (workflowIds.length === 0 && folderIds.length === 0) return
      const folders = getFolderMap(workspaceId)
      const workflows = getWorkflows(workspaceId)
      const isDestination = (parent: string | null | undefined) => (parent ?? null) === destination
      const siblings: SiblingItem[] = [
        ...Object.values(folders)
          .filter((folder) => isDestination(folder.parentId))
          .map((folder) => ({
            type: 'folder' as const,
            id: folder.id,
            sortOrder: folder.sortOrder,
            createdAt: folder.createdAt,
          })),
        ...workflows
          .filter((workflow) => isDestination(workflow.folderId))
          .map((workflow) => ({
            type: 'workflow' as const,
            id: workflow.id,
            sortOrder: workflow.sortOrder,
            createdAt: workflow.createdAt,
          })),
      ].sort(compareByOrder)

      const movingIds = new Set([...workflowIds, ...folderIds])
      const remaining = siblings.filter((item) => !movingIds.has(item.id))
      const fromDestination: SiblingItem[] = []
      const fromOther: SiblingItem[] = []
      for (const id of workflowIds) {
        const workflow = workflows.find((w) => w.id === id)
        if (!workflow) continue
        const item: SiblingItem = {
          type: 'workflow',
          id,
          sortOrder: workflow.sortOrder,
          createdAt: workflow.createdAt,
        }
        if (isDestination(workflow.folderId)) fromDestination.push(item)
        else fromOther.push(item)
      }
      for (const id of folderIds) {
        const folder = folders[id]
        if (!folder) continue
        const item: SiblingItem = {
          type: 'folder',
          id,
          sortOrder: folder.sortOrder,
          createdAt: folder.createdAt,
        }
        if (isDestination(folder.parentId)) fromDestination.push(item)
        else fromOther.push(item)
      }
      fromDestination.sort(compareByOrder)
      fromOther.sort(compareByOrder)

      const indexed = [...remaining, ...fromDestination, ...fromOther].map((item, index) => ({
        ...item,
        sortOrder: index,
      }))
      const folderUpdates = indexed
        .filter((item) => item.type === 'folder')
        .map((item) => ({ id: item.id, sortOrder: item.sortOrder, parentId: destination }))
      const workflowUpdates = indexed
        .filter((item) => item.type === 'workflow')
        .map((item) => ({ id: item.id, sortOrder: item.sortOrder, folderId: destination }))

      try {
        const pending: Promise<unknown>[] = []
        if (folderUpdates.length > 0)
          pending.push(reorderFolders({ workspaceId, updates: folderUpdates }))
        if (workflowUpdates.length > 0)
          pending.push(reorderWorkflows({ workspaceId, updates: workflowUpdates }))
        const results = await Promise.allSettled(pending)
        const rejected = results.filter((result) => result.status === 'rejected')
        if (rejected.length > 0)
          throw new ReorderFailedError(
            rejected.length < results.length,
            rejected.map((result) => result.reason)
          )
      } catch (error) {
        logger.error('Failed to move items', { error })
        toast.error(
          error instanceof ReorderFailedError && error.partial
            ? 'Only some items moved'
            : 'Failed to move items'
        )
      }
    },
    [reorderFolders, reorderWorkflows, workspaceId]
  )

  return {
    createWorkflow,
    isCreatingWorkflow: createWorkflowMutation.isPending,
    createFolder,
    isCreatingFolder: createFolderMutation.isPending,
    duplicate,
    isDuplicating,
    exportFolder,
    exportingFolderId,
    importFiles,
    isImporting,
    moveInto,
  }
}
