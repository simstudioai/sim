import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import { withOptimisticUpdate } from '@/lib/utils'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('FoldersStore')

export interface Workflow {
  id: string
  folderId?: string | null
  name?: string
  description?: string
  userId?: string
  workspaceId?: string
  [key: string]: any // For additional properties
}

export interface WorkflowFolder {
  id: string
  name: string
  userId: string
  workspaceId: string
  parentId: string | null
  color: string
  isExpanded: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

export interface FolderTreeNode extends WorkflowFolder {
  children: FolderTreeNode[]
  level: number
}

interface FolderState {
  folders: Record<string, WorkflowFolder>
  isLoading: boolean
  expandedFolders: Set<string>
  selectedWorkflows: Set<string>

  // Actions
  setFolders: (folders: WorkflowFolder[]) => void
  addFolder: (folder: WorkflowFolder) => void
  updateFolder: (id: string, updates: Partial<WorkflowFolder>) => void
  removeFolder: (id: string) => void
  setLoading: (loading: boolean) => void
  toggleExpanded: (folderId: string) => void
  setExpanded: (folderId: string, expanded: boolean) => void

  // Selection actions
  selectWorkflow: (workflowId: string) => void
  deselectWorkflow: (workflowId: string) => void
  toggleWorkflowSelection: (workflowId: string) => void
  clearSelection: () => void
  selectOnly: (workflowId: string) => void
  selectRange: (workflowIds: string[], fromId: string, toId: string) => void
  isWorkflowSelected: (workflowId: string) => boolean

  // Computed values
  getFolderTree: (workspaceId: string) => FolderTreeNode[]
  getFolderById: (id: string) => WorkflowFolder | undefined
  getChildFolders: (parentId: string | null) => WorkflowFolder[]
  getFolderPath: (folderId: string) => WorkflowFolder[]

  // API actions
  fetchFolders: (workspaceId: string) => Promise<void>
  createFolder: (data: {
    name: string
    workspaceId: string
    parentId?: string
    color?: string
  }) => Promise<WorkflowFolder>
  updateFolderAPI: (id: string, updates: Partial<WorkflowFolder>) => Promise<WorkflowFolder>
  deleteFolder: (id: string, workspaceId: string) => Promise<void>
  duplicateFolder: (id: string) => Promise<string | null>

  // Helper functions
  isWorkflowInDeletedSubfolder: (workflow: Workflow, deletedFolderId: string) => boolean
  removeSubfoldersRecursively: (parentFolderId: string) => void
}

export const useFolderStore = create<FolderState>()(
  devtools(
    (set, get) => ({
      folders: {},
      isLoading: false,
      expandedFolders: new Set(),
      selectedWorkflows: new Set(),

      setFolders: (folders) =>
        set(() => ({
          folders: folders.reduce(
            (acc, folder) => {
              acc[folder.id] = folder
              return acc
            },
            {} as Record<string, WorkflowFolder>
          ),
        })),

      addFolder: (folder) =>
        set((state) => ({
          folders: { ...state.folders, [folder.id]: folder },
        })),

      updateFolder: (id, updates) =>
        set((state) => ({
          folders: {
            ...state.folders,
            [id]: state.folders[id] ? { ...state.folders[id], ...updates } : state.folders[id],
          },
        })),

      removeFolder: (id) =>
        set((state) => {
          const newFolders = { ...state.folders }
          delete newFolders[id]
          return { folders: newFolders }
        }),

      setLoading: (loading) => set({ isLoading: loading }),

      toggleExpanded: (folderId) =>
        set((state) => {
          const newExpanded = new Set(state.expandedFolders)
          if (newExpanded.has(folderId)) {
            newExpanded.delete(folderId)
          } else {
            newExpanded.add(folderId)
          }
          return { expandedFolders: newExpanded }
        }),

      setExpanded: (folderId, expanded) =>
        set((state) => {
          const newExpanded = new Set(state.expandedFolders)
          if (expanded) {
            newExpanded.add(folderId)
          } else {
            newExpanded.delete(folderId)
          }
          return { expandedFolders: newExpanded }
        }),

      // Selection actions
      selectWorkflow: (workflowId) =>
        set((state) => {
          const newSelected = new Set(state.selectedWorkflows)
          newSelected.add(workflowId)
          return { selectedWorkflows: newSelected }
        }),

      deselectWorkflow: (workflowId) =>
        set((state) => {
          const newSelected = new Set(state.selectedWorkflows)
          newSelected.delete(workflowId)
          return { selectedWorkflows: newSelected }
        }),

      toggleWorkflowSelection: (workflowId) =>
        set((state) => {
          const newSelected = new Set(state.selectedWorkflows)
          if (newSelected.has(workflowId)) {
            newSelected.delete(workflowId)
          } else {
            newSelected.add(workflowId)
          }
          return { selectedWorkflows: newSelected }
        }),

      clearSelection: () => set({ selectedWorkflows: new Set() }),

      selectOnly: (workflowId) => set({ selectedWorkflows: new Set([workflowId]) }),

      selectRange: (workflowIds, fromId, toId) => {
        const fromIndex = workflowIds.indexOf(fromId)
        const toIndex = workflowIds.indexOf(toId)

        if (fromIndex === -1 || toIndex === -1) return

        const [start, end] = fromIndex < toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex]
        const rangeIds = workflowIds.slice(start, end + 1)

        set({ selectedWorkflows: new Set(rangeIds) })
      },

      isWorkflowSelected: (workflowId) => get().selectedWorkflows.has(workflowId),

      getFolderTree: (workspaceId) => {
        const folders = Object.values(get().folders).filter((f) => f.workspaceId === workspaceId)

        const buildTree = (parentId: string | null, level = 0): FolderTreeNode[] => {
          return folders
            .filter((folder) => folder.parentId === parentId)
            .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
            .map((folder) => ({
              ...folder,
              children: buildTree(folder.id, level + 1),
              level,
            }))
        }

        return buildTree(null)
      },

      getFolderById: (id) => get().folders[id],

      getChildFolders: (parentId) =>
        Object.values(get().folders)
          .filter((folder) => folder.parentId === parentId)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),

      getFolderPath: (folderId) => {
        const folders = get().folders
        const path: WorkflowFolder[] = []
        let currentId: string | null = folderId

        while (currentId && folders[currentId]) {
          const folder: WorkflowFolder = folders[currentId]
          path.unshift(folder)
          currentId = folder.parentId
        }

        return path
      },

      fetchFolders: async (workspaceId) => {
        set({ isLoading: true })
        try {
          const response = await fetch(`/api/folders?workspaceId=${workspaceId}`)
          if (!response.ok) {
            throw new Error('Failed to fetch folders')
          }
          const { folders }: { folders: any[] } = await response.json()

          // Convert date strings to Date objects
          const processedFolders: WorkflowFolder[] = folders.map((folder: any) => ({
            id: folder.id,
            name: folder.name,
            userId: folder.userId,
            workspaceId: folder.workspaceId,
            parentId: folder.parentId,
            color: folder.color,
            isExpanded: folder.isExpanded,
            sortOrder: folder.sortOrder,
            createdAt: new Date(folder.createdAt),
            updatedAt: new Date(folder.updatedAt),
          }))

          get().setFolders(processedFolders)

          // Start with all folders collapsed - only active workflow path will be expanded by the UI
          set({ expandedFolders: new Set() })
        } catch (error) {
          logger.error('Error fetching folders:', error)
        } finally {
          set({ isLoading: false })
        }
      },

      createFolder: async (data) => {
        const response = await fetch('/api/folders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || 'Failed to create folder')
        }

        const { folder } = await response.json()
        const processedFolder = {
          ...folder,
          createdAt: new Date(folder.createdAt),
          updatedAt: new Date(folder.updatedAt),
        }

        get().addFolder(processedFolder)
        return processedFolder
      },

      updateFolderAPI: async (id, updates) => {
        const originalFolder = get().folders[id]
        if (!originalFolder) {
          throw new Error('Folder not found')
        }

        let updatedFolder: WorkflowFolder | null = null

        await withOptimisticUpdate({
          getCurrentState: () => originalFolder,
          optimisticUpdate: () => {
            get().updateFolder(id, { ...updates, updatedAt: new Date() })
          },
          apiCall: async () => {
            const response = await fetch(`/api/folders/${id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updates),
            })

            if (!response.ok) {
              const error = await response.json()
              throw new Error(error.error || 'Failed to update folder')
            }

            const { folder } = await response.json()
            const processedFolder = {
              ...folder,
              createdAt: new Date(folder.createdAt),
              updatedAt: new Date(folder.updatedAt),
            }

            get().updateFolder(id, processedFolder)
            updatedFolder = processedFolder
          },
          rollback: (original) => {
            get().updateFolder(id, original)
          },
          errorMessage: 'Failed to update folder',
        })

        return updatedFolder || { ...originalFolder, ...updates }
      },

      deleteFolder: async (id: string, workspaceId: string) => {
        const getAllSubfolderIds = (parentId: string): string[] => {
          const folders = get().folders
          const childIds = Object.keys(folders).filter(
            (folderId) => folders[folderId].parentId === parentId
          )
          const allIds = [...childIds]

          childIds.forEach((childId) => {
            allIds.push(...getAllSubfolderIds(childId))
          })

          return allIds
        }

        const deletedFolderIds = [id, ...getAllSubfolderIds(id)]

        await withOptimisticUpdate({
          getCurrentState: () => ({
            folders: { ...get().folders },
            expandedFolders: new Set(get().expandedFolders),
          }),
          optimisticUpdate: () => {
            deletedFolderIds.forEach((folderId) => {
              get().removeFolder(folderId)
            })

            set((state) => {
              const newExpanded = new Set(state.expandedFolders)
              deletedFolderIds.forEach((folderId) => newExpanded.delete(folderId))
              return { expandedFolders: newExpanded }
            })
          },
          apiCall: async () => {
            const response = await fetch(`/api/folders/${id}`, { method: 'DELETE' })

            if (!response.ok) {
              const error = await response.json()
              throw new Error(error.error || 'Failed to delete folder')
            }

            const responseData = await response.json()
            logger.info(
              `Deleted ${responseData.deletedItems.workflows} workflow(s) and ${responseData.deletedItems.folders} folder(s)`
            )

            const workflowRegistry = useWorkflowRegistry.getState()
            await workflowRegistry.loadWorkflows(workspaceId)
          },
          rollback: (originalState) => {
            set({ folders: originalState.folders, expandedFolders: originalState.expandedFolders })
          },
          errorMessage: 'Failed to delete folder',
        })
      },

      duplicateFolder: async (id: string) => {
        const sourceFolder = get().folders[id]
        if (!sourceFolder) {
          logger.error(`Folder ${id} not found`)
          return null
        }

        try {
          const response = await fetch(`/api/folders/${id}/duplicate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `${sourceFolder.name} (Copy)`,
              workspaceId: sourceFolder.workspaceId,
              parentId: sourceFolder.parentId,
              color: sourceFolder.color,
            }),
          })

          if (!response.ok) {
            const error = await response.json()
            throw new Error(error.error || 'Failed to duplicate folder')
          }

          const result = await response.json()

          logger.info(
            `Successfully duplicated folder ${id} to ${result.id} with ${result.foldersCount} folder(s) and ${result.workflowsCount} workflow(s)`
          )

          // Reload folders and workflows to reflect the duplication
          const workflowRegistry = useWorkflowRegistry.getState()
          await Promise.all([
            get().fetchFolders(sourceFolder.workspaceId),
            workflowRegistry.loadWorkflows(sourceFolder.workspaceId),
          ])

          return result.id
        } catch (error) {
          logger.error(`Failed to duplicate folder ${id}:`, error)
          throw error
        }
      },

      isWorkflowInDeletedSubfolder: (workflow: Workflow, deletedFolderId: string) => {
        if (!workflow.folderId) return false

        const folders = get().folders
        let currentFolderId: string | null = workflow.folderId

        while (currentFolderId && folders[currentFolderId]) {
          if (currentFolderId === deletedFolderId) {
            return true
          }
          currentFolderId = folders[currentFolderId].parentId
        }

        return false
      },

      removeSubfoldersRecursively: (parentFolderId: string) => {
        const folders = get().folders
        const childFolderIds = Object.keys(folders).filter(
          (id) => folders[id].parentId === parentFolderId
        )

        childFolderIds.forEach((childId) => {
          get().removeSubfoldersRecursively(childId)
          get().removeFolder(childId)
        })
      },
    }),
    { name: 'folder-store' }
  )
)

export const useIsWorkflowSelected = (workflowId: string) =>
  useFolderStore((state) => state.selectedWorkflows.has(workflowId))
