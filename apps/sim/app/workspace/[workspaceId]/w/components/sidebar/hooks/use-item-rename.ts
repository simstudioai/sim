import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('useItemRename')

interface UseItemRenameProps {
  /**
   * Current item name
   */
  initialName: string
  /**
   * Callback to save the new name
   */
  onSave: (newName: string) => Promise<void>
  /**
   * Item type for logging
   */
  itemType: 'workflow' | 'folder' | 'workspace'
  /**
   * Item ID for logging
   */
  itemId: string
}

/**
 * Hook for managing inline rename functionality for workflows, folders, and workspaces.
 *
 * Handles:
 * - Edit state management
 * - Input value tracking
 * - Save/cancel operations
 * - Keyboard shortcuts (Enter to save, Escape to cancel)
 * - Auto-focus and selection
 * - Loading state during save
 *
 * @param props - Hook configuration
 * @returns Rename state and handlers
 */
export function useItemRename({ initialName, onSave, itemType, itemId }: UseItemRenameProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(initialName)
  const [isRenaming, setIsRenaming] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  /**
   * Update edit value when initial name changes
   */
  useEffect(() => {
    setEditValue(initialName)
  }, [initialName])

  /**
   * Focus and select input when entering edit mode
   */
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  /**
   * Start editing mode
   */
  const handleStartEdit = useCallback(() => {
    setIsEditing(true)
    setEditValue(initialName)
  }, [initialName])

  /**
   * Save the new name
   */
  const handleSaveEdit = useCallback(async () => {
    const trimmedValue = editValue.trim()

    // If empty or unchanged, just cancel
    if (!trimmedValue || trimmedValue === initialName) {
      setIsEditing(false)
      setEditValue(initialName)
      return
    }

    setIsRenaming(true)
    try {
      await onSave(trimmedValue)
      logger.info(`Successfully renamed ${itemType} from "${initialName}" to "${trimmedValue}"`)
      setIsEditing(false)
    } catch (error) {
      logger.error(`Failed to rename ${itemType}:`, {
        error,
        itemId,
        oldName: initialName,
        newName: trimmedValue,
      })
      // Reset to original name on error
      setEditValue(initialName)
    } finally {
      setIsRenaming(false)
    }
  }, [editValue, initialName, onSave, itemType, itemId])

  /**
   * Cancel editing and restore original name
   */
  const handleCancelEdit = useCallback(() => {
    setIsEditing(false)
    setEditValue(initialName)
  }, [initialName])

  /**
   * Handle keyboard shortcuts
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSaveEdit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleCancelEdit()
      }
    },
    [handleSaveEdit, handleCancelEdit]
  )

  /**
   * Handle input blur (unfocus)
   */
  const handleInputBlur = useCallback(() => {
    handleSaveEdit()
  }, [handleSaveEdit])

  return {
    isEditing,
    editValue,
    isRenaming,
    inputRef,
    setEditValue,
    handleStartEdit,
    handleSaveEdit,
    handleCancelEdit,
    handleKeyDown,
    handleInputBlur,
  }
}
