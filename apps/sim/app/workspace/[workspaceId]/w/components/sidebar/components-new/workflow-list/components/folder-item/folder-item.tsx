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
  const shouldPreventClickRef = useRef(false)

  const handleToggleExpanded = useCallback(() => {
    toggleExpanded(folder.id)
  }, [folder.id, toggleExpanded])

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()

      if (shouldPreventClickRef.current) {
        e.preventDefault()
        return
      }
      handleToggleExpanded()
    },
    [handleToggleExpanded]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        handleToggleExpanded()
      }
    },
    [handleToggleExpanded]
  )

  const handleDragStart = (e: React.DragEvent) => {
    shouldPreventClickRef.current = true
    setIsDragging(true)

    e.dataTransfer.setData('folder-id', folder.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragEnd = () => {
    setIsDragging(false)
    requestAnimationFrame(() => {
      shouldPreventClickRef.current = false
    })
  }

  return (
    <div onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
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
        <span className='truncate font-medium text-[#AEAEAE] dark:text-[#AEAEAE]'>
          {folder.name}
        </span>
      </div>
    </div>
  )
}
