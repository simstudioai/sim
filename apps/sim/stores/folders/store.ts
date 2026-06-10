import { createLogger } from '@sim/logger'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

const logger = createLogger('FoldersStore')

interface FolderState {
  expandedFolders: Set<string>
  selectedWorkflows: Set<string>
  selectedFolders: Set<string>
  lastSelectedFolderId: string | null
  selectedChats: Set<string>
  lastSelectedChatId: string | null

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

  // Chat selection actions
  selectChatOnly: (chatId: string) => void
  toggleChatSelection: (chatId: string) => void
  selectChatRange: (chatIds: string[], fromId: string, toId: string) => void
  clearChatSelection: () => void
  isChatSelected: (chatId: string) => boolean

  // Unified selection helpers
  getFullSelection: () => { workflowIds: string[]; folderIds: string[]; chatIds: string[] }
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
      selectedChats: new Set(),
      lastSelectedChatId: null,

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
            ...(state.selectedChats.size > 0 && {
              selectedChats: new Set<string>(),
              lastSelectedChatId: null,
            }),
          }
        }),

      clearSelection: () => set({ selectedWorkflows: new Set() }),

      selectOnly: (workflowId) =>
        set({
          selectedWorkflows: new Set([workflowId]),
          selectedFolders: new Set(),
          lastSelectedFolderId: null,
          selectedChats: new Set(),
          lastSelectedChatId: null,
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
            ...(state.selectedChats.size > 0 && {
              selectedChats: new Set<string>(),
              lastSelectedChatId: null,
            }),
          }
        }),

      clearFolderSelection: () => set({ selectedFolders: new Set(), lastSelectedFolderId: null }),

      selectFolderOnly: (folderId) =>
        set({
          selectedFolders: new Set([folderId]),
          lastSelectedFolderId: folderId,
          selectedChats: new Set(),
          lastSelectedChatId: null,
        }),

      selectFolderRange: (folderIds, fromId, toId) => {
        const fromIndex = folderIds.indexOf(fromId)
        const toIndex = folderIds.indexOf(toId)

        if (fromIndex === -1 || toIndex === -1) return

        const [start, end] = fromIndex < toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex]
        const rangeIds = folderIds.slice(start, end + 1)

        set({ selectedFolders: new Set(rangeIds), lastSelectedFolderId: fromId })
      },

      isFolderSelected: (folderId) => get().selectedFolders.has(folderId),

      // Chat selection actions
      selectChatOnly: (chatId) =>
        set((state) => ({
          selectedChats: new Set([chatId]),
          lastSelectedChatId: chatId,
          ...(state.selectedWorkflows.size > 0 && { selectedWorkflows: new Set<string>() }),
          ...(state.selectedFolders.size > 0 && {
            selectedFolders: new Set<string>(),
            lastSelectedFolderId: null,
          }),
        })),

      toggleChatSelection: (chatId) =>
        set((state) => {
          const newSelected = new Set(state.selectedChats)
          let newLastSelected: string | null
          if (newSelected.has(chatId)) {
            newSelected.delete(chatId)
            newLastSelected =
              state.lastSelectedChatId === chatId
                ? (Array.from(newSelected)[0] ?? null)
                : state.lastSelectedChatId
          } else {
            newSelected.add(chatId)
            newLastSelected = chatId
          }
          return {
            selectedChats: newSelected,
            lastSelectedChatId: newLastSelected,
            ...(state.selectedWorkflows.size > 0 && { selectedWorkflows: new Set<string>() }),
            ...(state.selectedFolders.size > 0 && {
              selectedFolders: new Set<string>(),
              lastSelectedFolderId: null,
            }),
          }
        }),

      selectChatRange: (chatIds, fromId, toId) => {
        const fromIndex = chatIds.indexOf(fromId)
        const toIndex = chatIds.indexOf(toId)

        if (fromIndex === -1 || toIndex === -1) return

        const [start, end] = fromIndex < toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex]
        const rangeIds = chatIds.slice(start, end + 1)

        const state = get()
        set({
          selectedChats: new Set(rangeIds),
          lastSelectedChatId: fromId,
          ...(state.selectedWorkflows.size > 0 && { selectedWorkflows: new Set<string>() }),
          ...(state.selectedFolders.size > 0 && {
            selectedFolders: new Set<string>(),
            lastSelectedFolderId: null,
          }),
        })
      },

      clearChatSelection: () => set({ selectedChats: new Set(), lastSelectedChatId: null }),

      isChatSelected: (chatId) => get().selectedChats.has(chatId),

      // Unified selection helpers
      getFullSelection: () => ({
        workflowIds: Array.from(get().selectedWorkflows),
        folderIds: Array.from(get().selectedFolders),
        chatIds: Array.from(get().selectedChats),
      }),

      hasAnySelection: () =>
        get().selectedWorkflows.size > 0 ||
        get().selectedFolders.size > 0 ||
        get().selectedChats.size > 0,

      isMixedSelection: () => get().selectedWorkflows.size > 0 && get().selectedFolders.size > 0,

      clearAllSelection: () =>
        set({
          selectedWorkflows: new Set(),
          selectedFolders: new Set(),
          lastSelectedFolderId: null,
          selectedChats: new Set(),
          lastSelectedChatId: null,
        }),
    }),
    { name: 'folder-store' }
  )
)

export const useIsWorkflowSelected = (workflowId: string) =>
  useFolderStore((state) => state.selectedWorkflows.has(workflowId))

export const useIsFolderSelected = (folderId: string) =>
  useFolderStore((state) => state.selectedFolders.has(folderId))
