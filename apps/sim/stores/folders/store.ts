import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

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
  deleteFolder: (id: string, moveWorkflowsTo?: string) => Promise<void>
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
          console.error('Error fetching folders:', error)
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

        // Update expanded state if isExpanded was changed
        if (updates.isExpanded !== undefined) {
          get().setExpanded(id, updates.isExpanded)
        }

        return processedFolder
      },

      deleteFolder: async (id, moveWorkflowsTo) => {
        const url = moveWorkflowsTo
          ? `/api/folders/${id}?moveWorkflowsTo=${moveWorkflowsTo}`
          : `/api/folders/${id}`

        const response = await fetch(url, { method: 'DELETE' })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || 'Failed to delete folder')
        }

        get().removeFolder(id)

        // Remove from expanded state
        set((state) => {
          const newExpanded = new Set(state.expandedFolders)
          newExpanded.delete(id)
          return { expandedFolders: newExpanded }
        })
      },
    }),
    { name: 'folder-store' }
  )
)

// Selector hook for checking if a workflow is selected (avoids get() calls)
export const useIsWorkflowSelected = (workflowId: string) =>
  useFolderStore((state) => state.selectedWorkflows.has(workflowId))
