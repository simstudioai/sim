'use client'

import { createContext, useContext, useMemo } from 'react'

interface SidebarDragContextValue {
  /** Whether any drag operation is currently in progress */
  isAnyDragActive: boolean
}

/**
 * Context for sharing drag state across sidebar components.
 * Eliminates prop drilling of isAnyDragActive through component tree.
 */
export const SidebarDragContext = createContext<SidebarDragContextValue>({
  isAnyDragActive: false,
})

/**
 * Hook to access the sidebar drag state.
 * Use this in WorkflowItem, FolderItem, etc. to check if any drag is in progress.
 *
 * @returns The current drag state
 */
export function useSidebarDragContext(): SidebarDragContextValue {
  return useContext(SidebarDragContext)
}

/**
 * Hook to create the sidebar drag context value.
 *
 * @param isDragging - Whether a drag is currently in progress
 * @returns Context value to provide to SidebarDragContext.Provider
 */
export function useSidebarDragContextValue(isDragging: boolean): SidebarDragContextValue {
  return useMemo(() => ({ isAnyDragActive: isDragging }), [isDragging])
}
