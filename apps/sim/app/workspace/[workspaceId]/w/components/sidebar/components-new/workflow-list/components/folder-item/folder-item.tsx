'use client'

import { useCallback } from 'react'
import clsx from 'clsx'
import { ChevronRight, Folder, FolderOpen } from 'lucide-react'
import type { FolderTreeNode } from '@/stores/folders/store'
import { useFolderExpand } from '../../../../hooks/use-folder-expand'
import { useItemDrag } from '../../../../hooks/use-item-drag'

interface FolderItemProps {
  folder: FolderTreeNode
  level: number
}

/**
 * FolderItem component displaying a single folder with drag and expand/collapse support.
 * Uses item drag and folder expand hooks for unified behavior.
 *
 * @param props - Component props
 * @returns Folder item with drag and expand support
 */
export function FolderItem({ folder, level }: FolderItemProps) {
  // Folder expand hook
  const { isExpanded, handleToggleExpanded, handleKeyDown } = useFolderExpand({
    folderId: folder.id,
  })

  /**
   * Drag start handler - sets folder data for drag operation
   *
   * @param e - React drag event
   */
  const onDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.setData('folder-id', folder.id)
      e.dataTransfer.effectAllowed = 'move'
    },
    [folder.id]
  )

  // Item drag hook
  const { isDragging, shouldPreventClickRef, handleDragStart, handleDragEnd } = useItemDrag({
    onDragStart,
  })

  /**
   * Handle click - toggles folder expansion
   *
   * @param e - React mouse event
   */
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation()

      if (shouldPreventClickRef.current) {
        e.preventDefault()
        return
      }
      handleToggleExpanded()
    },
    [handleToggleExpanded, shouldPreventClickRef]
  )

  return (
    <div
      role='button'
      tabIndex={0}
      aria-expanded={isExpanded}
      aria-label={`${folder.name} folder, ${isExpanded ? 'expanded' : 'collapsed'}`}
      className={clsx(
        'flex h-[25px] cursor-pointer items-center rounded-[8px] text-[14px]',
        isDragging ? 'opacity-50' : ''
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <ChevronRight
        className={clsx(
          'mr-[8px] h-[10px] w-[10px] flex-shrink-0 text-[#787878] transition-all dark:text-[#787878]',
          isExpanded ? 'rotate-90' : ''
        )}
        aria-hidden='true'
      />
      {isExpanded ? (
        <FolderOpen
          className='mr-[10px] h-[16px] w-[16px] flex-shrink-0 text-[#787878] dark:text-[#787878]'
          aria-hidden='true'
        />
      ) : (
        <Folder
          className='mr-[10px] h-[16px] w-[16px] flex-shrink-0 text-[#787878] dark:text-[#787878]'
          aria-hidden='true'
        />
      )}
      <span className='truncate font-medium text-[#AEAEAE] dark:text-[#AEAEAE]'>{folder.name}</span>
    </div>
  )
}
