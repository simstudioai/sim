import { createLogger } from '@sim/logger'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { FolderTreeNode, WorkflowFolder } from './types'

const logger = createLogger('FoldersStore')

interface FolderState {
  folders: Record<string, WorkflowFolder>
  expandedFolders: Set<string>
  selectedWorkflows: Set<string>
  selectedFolders: Set<string>
  lastSelectedFolderId: string | null

  setFolders: (folders: WorkflowFolder[]) => void
  toggleExpanded: (folderId: string) => void
  setExpanded: (folderId: string, expanded: boolean) => void

  // Workflow selection actions
  selectWorkflow: (workflowId: string) => void
  deselectWorkflow: (workflowId: string) => void
  toggleWorkflowSelection: (workflowId: string) => void
  clearSelection: () => void
  selectOnly: (workflowId: string) => void
  selectRange: (workflowIds: string[], fromId: string, toId: string) => void
  isWorkflowSelected: (workflowId: string) => boolean

  // Folder selection actions
  selectFolder: (folderId: string) => void
  deselectFolder: (folderId: string) => void
  toggleFolderSelection: (folderId: string) => void
  clearFolderSelection: () => void
  selectFolderOnly: (folderId: string) => void
  selectFolderRange: (folderIds: string[], fromId: string, toId: string) => void
  isFolderSelected: (folderId: string) => boolean

  // Unified selection helpers
  getFullSelection: () => { workflowIds: string[]; folderIds: string[] }
  hasAnySelection: () => boolean
  isMixedSelection: () => boolean
  clearAllSelection: () => void

  // Computed values
  getFolderTree: (workspaceId: string) => FolderTreeNode[]
  getFolderById: (id: string) => WorkflowFolder | undefined
  getChildFolders: (parentId: string | null) => WorkflowFolder[]
  getFolderPath: (folderId: string) => WorkflowFolder[]
}

export const useFolderStore = create<FolderState>()(
  devtools(
    (set, get) => ({
      folders: {},
      expandedFolders: new Set(),
      selectedWorkflows: new Set(),
      selectedFolders: new Set(),
      lastSelectedFolderId: null,

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

      // Folder selection actions
      selectFolder: (folderId) =>
        set((state) => {
          const newSelected = new Set(state.selectedFolders)
          newSelected.add(folderId)
          return { selectedFolders: newSelected, lastSelectedFolderId: folderId }
        }),

      deselectFolder: (folderId) =>
        set((state) => {
          const newSelected = new Set(state.selectedFolders)
          newSelected.delete(folderId)
          // If deselecting the last selected folder, update anchor to another selected folder or null
          const newLastSelected =
            state.lastSelectedFolderId === folderId
              ? (Array.from(newSelected)[0] ?? null)
              : state.lastSelectedFolderId
          return { selectedFolders: newSelected, lastSelectedFolderId: newLastSelected }
        }),

      toggleFolderSelection: (folderId) =>
        set((state) => {
          const newSelected = new Set(state.selectedFolders)
          let newLastSelected: string | null
          if (newSelected.has(folderId)) {
            newSelected.delete(folderId)
            // If toggling off the last selected, pick another or null
            newLastSelected =
              state.lastSelectedFolderId === folderId
                ? (Array.from(newSelected)[0] ?? null)
                : state.lastSelectedFolderId
          } else {
            newSelected.add(folderId)
            // Always update anchor to the most recently clicked folder
            newLastSelected = folderId
          }
          return { selectedFolders: newSelected, lastSelectedFolderId: newLastSelected }
        }),

      clearFolderSelection: () => set({ selectedFolders: new Set(), lastSelectedFolderId: null }),

      selectFolderOnly: (folderId) =>
        set({ selectedFolders: new Set([folderId]), lastSelectedFolderId: folderId }),

      selectFolderRange: (folderIds, fromId, toId) => {
        const fromIndex = folderIds.indexOf(fromId)
        const toIndex = folderIds.indexOf(toId)

        if (fromIndex === -1 || toIndex === -1) return

        const [start, end] = fromIndex < toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex]
        const rangeIds = folderIds.slice(start, end + 1)

        // Keep the anchor as the "from" folder, update to "to" as the new last selected
        set({ selectedFolders: new Set(rangeIds), lastSelectedFolderId: toId })
      },

      isFolderSelected: (folderId) => get().selectedFolders.has(folderId),

      // Unified selection helpers
      getFullSelection: () => ({
        workflowIds: Array.from(get().selectedWorkflows),
        folderIds: Array.from(get().selectedFolders),
      }),

      hasAnySelection: () => get().selectedWorkflows.size > 0 || get().selectedFolders.size > 0,

      isMixedSelection: () => get().selectedWorkflows.size > 0 && get().selectedFolders.size > 0,

      clearAllSelection: () =>
        set({
          selectedWorkflows: new Set(),
          selectedFolders: new Set(),
          lastSelectedFolderId: null,
        }),

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
    }),
    { name: 'folder-store' }
  )
)

export const useIsWorkflowSelected = (workflowId: string) =>
  useFolderStore((state) => state.selectedWorkflows.has(workflowId))

export const useIsFolderSelected = (folderId: string) =>
  useFolderStore((state) => state.selectedFolders.has(folderId))
