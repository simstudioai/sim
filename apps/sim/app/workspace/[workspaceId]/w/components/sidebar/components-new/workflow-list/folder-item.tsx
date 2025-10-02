'use client'

import { useCallback, useRef, useState } from 'react'
import clsx from 'clsx'
import { ChevronRight, Folder, FolderOpen } from 'lucide-react'
import { type FolderTreeNode, useFolderStore } from '@/stores/folders/store'

interface FolderItemProps {
  folder: FolderTreeNode
  level: number
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}

export function FolderItem({ folder, level, onDragOver, onDragLeave, onDrop }: FolderItemProps) {
  const { expandedFolders, toggleExpanded } = useFolderStore()
  const isExpanded = expandedFolders.has(folder.id)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartedRef = useRef(false)

  const handleToggleExpanded = useCallback(() => {
    toggleExpanded(folder.id)
  }, [folder.id, toggleExpanded])

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()

      if (dragStartedRef.current) {
        e.preventDefault()
        return
      }
      handleToggleExpanded()
    },
    [handleToggleExpanded]
  )

  const handleDragStart = (e: React.DragEvent) => {
    dragStartedRef.current = true
    setIsDragging(true)

    e.dataTransfer.setData('folder-id', folder.id)
    e.dataTransfer.effectAllowed = 'move'

    // Set global drag state for validation in other components
    if (typeof window !== 'undefined') {
      ;(window as any).currentDragFolderId = folder.id
    }
  }

  const handleDragEnd = () => {
    setIsDragging(false)
    requestAnimationFrame(() => {
      dragStartedRef.current = false
    })

    // Clear global drag state
    if (typeof window !== 'undefined') {
      ;(window as any).currentDragFolderId = null
    }
  }

  return (
    <div className='mb-[2px]' onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div
        className={clsx(
          'flex h-[25px] cursor-pointer items-center rounded-[8px] text-small',
          isDragging ? 'opacity-50' : ''
        )}
        onClick={handleClick}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <ChevronRight
          className={clsx(
            'mr-[8px] h-[10px] w-[10px] flex-shrink-0 text-[#787878] transition-all dark:text-[#787878]',
            isExpanded ? 'rotate-90' : ''
          )}
        />
        {isExpanded ? (
          <FolderOpen className='mr-[10px] h-[16px] w-[16px] flex-shrink-0 text-[#787878] dark:text-[#787878]' />
        ) : (
          <Folder className='mr-[10px] h-[16px] w-[16px] flex-shrink-0 text-[#787878] dark:text-[#787878]' />
        )}
        <span className='truncate font-medium text-[#AEAEAE] dark:text-[#AEAEAE]'>
          {folder.name}
        </span>
      </div>
    </div>
  )
}
