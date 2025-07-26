import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowRegistry } from '../workflows/registry/store'

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

      clearSelection: () =>
        set(() => ({
          selectedWorkflows: new Set(),
        })),

      selectOnly: (workflowId) =>
        set(() => ({
          selectedWorkflows: new Set([workflowId]),
        })),

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

          // Initialize expanded state from folder data
          const expandedSet = new Set<string>()
          processedFolders.forEach((folder: WorkflowFolder) => {
            if (folder.isExpanded) {
              expandedSet.add(folder.id)
            }
          })
          set({ expandedFolders: expandedSet })
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

        return processedFolder
      },

      deleteFolder: async (id: string, workspaceId: string) => {
        const response = await fetch(`/api/folders/${id}`, { method: 'DELETE' })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || 'Failed to delete folder')
        }

        const responseData = await response.json()

        // Remove the folder from local state
        get().removeFolder(id)

        // Remove from expanded state
        set((state) => {
          const newExpanded = new Set(state.expandedFolders)
          newExpanded.delete(id)
          return { expandedFolders: newExpanded }
        })

        // Remove subfolders from local state
        get().removeSubfoldersRecursively(id)

        // The backend has already deleted the workflows, so we just need to refresh
        // the workflow registry to sync with the server state
        const workflowRegistry = useWorkflowRegistry.getState()
        if (workspaceId) {
          await workflowRegistry.loadWorkflows(workspaceId)
        }

        logger.info(
          `Deleted ${responseData.deletedItems.workflows} workflow(s) and ${responseData.deletedItems.folders} folder(s)`
        )
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

// Selector hook for checking if a workflow is selected (avoids get() calls)
export const useIsWorkflowSelected = (workflowId: string) =>
  useFolderStore((state) => state.selectedWorkflows.has(workflowId))
