import { createLogger } from '@sim/logger'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

const logger = createLogger('FoldersStore')

interface FolderState {
  expandedFolders: Set<string>
  selectedWorkflows: Set<string>
  selectedFolders: Set<string>
  lastSelectedFolderId: string | null
  selectedTasks: Set<string>
  lastSelectedTaskId: string | null

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

  // Task selection actions
  selectTaskOnly: (taskId: string) => void
  toggleTaskSelection: (taskId: string) => void
  selectTaskRange: (taskIds: string[], fromId: string, toId: string) => void
  clearTaskSelection: () => void
  isTaskSelected: (taskId: string) => boolean

  // Unified selection helpers
  getFullSelection: () => { workflowIds: string[]; folderIds: string[]; taskIds: string[] }
  hasAnySelection: () => boolean
  isMixedSelection: () => boolean
  clearAllSelection: () => void
}

export const useFolderStore = create<FolderState>()(
  devtools(
    (set, get) => ({
      expandedFolders: new Set(),
      selectedWorkflows: new Set(),
      selectedFolders: new Set(),
      lastSelectedFolderId: null,
      selectedTasks: new Set(),
      lastSelectedTaskId: null,

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
          return {
            selectedWorkflows: newSelected,
            ...(state.selectedTasks.size > 0 && {
              selectedTasks: new Set<string>(),
              lastSelectedTaskId: null,
            }),
          }
        }),

      clearSelection: () => set({ selectedWorkflows: new Set() }),

      selectOnly: (workflowId) =>
        set({
          selectedWorkflows: new Set([workflowId]),
          selectedFolders: new Set(),
          lastSelectedFolderId: null,
          selectedTasks: new Set(),
          lastSelectedTaskId: null,
        }),

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
          return {
            selectedFolders: newSelected,
            lastSelectedFolderId: newLastSelected,
            ...(state.selectedTasks.size > 0 && {
              selectedTasks: new Set<string>(),
              lastSelectedTaskId: null,
            }),
          }
        }),

      clearFolderSelection: () => set({ selectedFolders: new Set(), lastSelectedFolderId: null }),

      selectFolderOnly: (folderId) =>
        set({
          selectedFolders: new Set([folderId]),
          lastSelectedFolderId: folderId,
          selectedTasks: new Set(),
          lastSelectedTaskId: null,
        }),

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

      // Task selection actions
      selectTaskOnly: (taskId) =>
        set((state) => ({
          selectedTasks: new Set([taskId]),
          lastSelectedTaskId: taskId,
          ...(state.selectedWorkflows.size > 0 && { selectedWorkflows: new Set<string>() }),
          ...(state.selectedFolders.size > 0 && {
            selectedFolders: new Set<string>(),
            lastSelectedFolderId: null,
          }),
        })),

      toggleTaskSelection: (taskId) =>
        set((state) => {
          const newSelected = new Set(state.selectedTasks)
          let newLastSelected: string | null
          if (newSelected.has(taskId)) {
            newSelected.delete(taskId)
            newLastSelected =
              state.lastSelectedTaskId === taskId
                ? (Array.from(newSelected)[0] ?? null)
                : state.lastSelectedTaskId
          } else {
            newSelected.add(taskId)
            newLastSelected = taskId
          }
          return {
            selectedTasks: newSelected,
            lastSelectedTaskId: newLastSelected,
            ...(state.selectedWorkflows.size > 0 && { selectedWorkflows: new Set<string>() }),
            ...(state.selectedFolders.size > 0 && {
              selectedFolders: new Set<string>(),
              lastSelectedFolderId: null,
            }),
          }
        }),

      selectTaskRange: (taskIds, fromId, toId) => {
        const fromIndex = taskIds.indexOf(fromId)
        const toIndex = taskIds.indexOf(toId)

        if (fromIndex === -1 || toIndex === -1) return

        const [start, end] = fromIndex < toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex]
        const rangeIds = taskIds.slice(start, end + 1)

        const state = get()
        set({
          selectedTasks: new Set(rangeIds),
          lastSelectedTaskId: toId,
          ...(state.selectedWorkflows.size > 0 && { selectedWorkflows: new Set<string>() }),
          ...(state.selectedFolders.size > 0 && {
            selectedFolders: new Set<string>(),
            lastSelectedFolderId: null,
          }),
        })
      },

      clearTaskSelection: () => set({ selectedTasks: new Set(), lastSelectedTaskId: null }),

      isTaskSelected: (taskId) => get().selectedTasks.has(taskId),

      // Unified selection helpers
      getFullSelection: () => ({
        workflowIds: Array.from(get().selectedWorkflows),
        folderIds: Array.from(get().selectedFolders),
        taskIds: Array.from(get().selectedTasks),
      }),

      hasAnySelection: () =>
        get().selectedWorkflows.size > 0 ||
        get().selectedFolders.size > 0 ||
        get().selectedTasks.size > 0,

      isMixedSelection: () => get().selectedWorkflows.size > 0 && get().selectedFolders.size > 0,

      clearAllSelection: () =>
        set({
          selectedWorkflows: new Set(),
          selectedFolders: new Set(),
          lastSelectedFolderId: null,
          selectedTasks: new Set(),
          lastSelectedTaskId: null,
        }),
    }),
    { name: 'folder-store' }
  )
)

export const useIsWorkflowSelected = (workflowId: string) =>
  useFolderStore((state) => state.selectedWorkflows.has(workflowId))

export const useIsFolderSelected = (folderId: string) =>
  useFolderStore((state) => state.selectedFolders.has(folderId))
