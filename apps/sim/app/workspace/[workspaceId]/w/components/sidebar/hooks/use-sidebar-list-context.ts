'use client'

import { createContext, use, useMemo } from 'react'

interface SidebarListContextValue {
  /** Whether any drag operation is currently in progress */
  isAnyDragActive: boolean
  /** Whether item dragging is disabled (e.g. viewer permissions) */
  dragDisabled: boolean
  /** Selects a workflow on click (single or shift-range selection) */
  onWorkflowClick: (workflowId: string, shiftKey: boolean) => void
  /** Selects a folder on modifier-click (shift-range or cmd/ctrl-toggle selection) */
  onFolderClick: (folderId: string, shiftKey: boolean, metaKey: boolean) => void
  /** Notifies the list that an item drag started from the given parent folder */
  onItemDragStart: (parentFolderId: string | null) => void
  /** Notifies the list that an item drag ended */
  onItemDragEnd: () => void
}

const noop = () => {}

/**
 * Context for sharing list-item interaction handlers and drag state across
 * sidebar workflow-list components. Eliminates prop drilling of selection
 * and drag callbacks into WorkflowItem/FolderItem.
 */
export const SidebarListContext = createContext<SidebarListContextValue>({
  isAnyDragActive: false,
  dragDisabled: false,
  onWorkflowClick: noop,
  onFolderClick: noop,
  onItemDragStart: noop,
  onItemDragEnd: noop,
})

/**
 * Hook to access the sidebar list context.
 * Use this in WorkflowItem, FolderItem, etc. for selection/drag callbacks and drag state.
 *
 * @returns The current sidebar list context value
 */
export function useSidebarListContext(): SidebarListContextValue {
  return use(SidebarListContext)
}

/**
 * Hook to create a memoized sidebar list context value.
 *
 * @param value - The handlers and drag state to expose to list items
 * @returns Memoized context value to provide to SidebarListContext.Provider
 */
export function useSidebarListContextValue(
  value: SidebarListContextValue
): SidebarListContextValue {
  const {
    isAnyDragActive,
    dragDisabled,
    onWorkflowClick,
    onFolderClick,
    onItemDragStart,
    onItemDragEnd,
  } = value

  return useMemo(
    () => ({
      isAnyDragActive,
      dragDisabled,
      onWorkflowClick,
      onFolderClick,
      onItemDragStart,
      onItemDragEnd,
    }),
    [isAnyDragActive, dragDisabled, onWorkflowClick, onFolderClick, onItemDragStart, onItemDragEnd]
  )
}
