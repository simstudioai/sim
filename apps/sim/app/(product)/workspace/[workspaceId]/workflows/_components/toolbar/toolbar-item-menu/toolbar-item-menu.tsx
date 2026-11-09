'use client'

import type { ReactNode } from 'react'
import { ContextActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'

interface ToolbarItemMenuProps {
  /** The item's name, which the menu's accessible label carries. */
  label: string
  /**
   * Callback when add to canvas is clicked
   */
  onAddToCanvas: () => void
  /**
   * Callback when view documentation is clicked
   */
  onViewDocumentation?: () => void
  /**
   * Whether the view documentation option should be shown
   */
  showViewDocumentation?: boolean
  /** The toolbar item a secondary click opens the menu on. */
  children: ReactNode
}

/**
 * Context menu for toolbar items (triggers and blocks), opened at the pointer by a secondary click.
 * Offers to add the item to the canvas and, when it has docs, to open them.
 */
export function ToolbarItemMenu({
  label,
  onAddToCanvas,
  onViewDocumentation,
  showViewDocumentation = false,
  children,
}: ToolbarItemMenuProps) {
  const actions = (): MenuAction[] => [
    { id: 'add-to-canvas', label: 'Add to canvas', icon: 'I074', onSelect: onAddToCanvas },
    ...(showViewDocumentation && onViewDocumentation
      ? [
          {
            id: 'view-documentation',
            label: 'View documentation',
            icon: 'I082',
            onSelect: onViewDocumentation,
          } satisfies MenuAction,
        ]
      : []),
  ]
  return (
    <ContextActionMenu label={`Actions for ${label}`} actions={actions}>
      {children}
    </ContextActionMenu>
  )
}
