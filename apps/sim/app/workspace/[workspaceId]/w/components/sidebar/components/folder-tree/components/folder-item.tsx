'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Folder, FolderOpen } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console-logger'
import { type FolderTreeNode, useFolderStore } from '@/stores/folders/store'
import { FolderContextMenu } from '../../folder-context-menu/folder-context-menu'

const logger = createLogger('FolderItem')

interface FolderItemProps {
  folder: FolderTreeNode
  isCollapsed?: boolean
  onCreateWorkflow: (folderId?: string) => void
  dragOver?: boolean
  onDragOver?: (e: React.DragEvent) => void
  onDragLeave?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  isFirstItem?: boolean
  level: number
}

export function FolderItem({
  folder,
  isCollapsed,
  onCreateWorkflow,
  dragOver = false,
  onDragOver,
  onDragLeave,
  onDrop,
  isFirstItem = false,
  level,
}: FolderItemProps) {
  const { expandedFolders, toggleExpanded, updateFolderAPI, deleteFolder } = useFolderStore()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(folder.name)
  const [isRenaming, setIsRenaming] = useState(false)
  const dragStartedRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const isExpanded = expandedFolders.has(folder.id)
  const updateTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pendingStateRef = useRef<boolean | null>(null)

  // Update editValue when folder name changes
  useEffect(() => {
    setEditValue(folder.name)
  }, [folder.name])

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleToggleExpanded = useCallback(() => {
    if (isEditing) return // Don't toggle when editing

    const newExpandedState = !isExpanded
    toggleExpanded(folder.id)
    pendingStateRef.current = newExpandedState

    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current)
    }

    updateTimeoutRef.current = setTimeout(() => {
      if (pendingStateRef.current === newExpandedState) {
        updateFolderAPI(folder.id, { isExpanded: newExpandedState })
          .catch(console.error)
          .finally(() => {
            pendingStateRef.current = null
          })
      }
    }, 300)
  }, [folder.id, isExpanded, toggleExpanded, updateFolderAPI, isEditing])

  const handleDragStart = (e: React.DragEvent) => {
    if (isEditing) return

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

  const handleClick = (e: React.MouseEvent) => {
    if (dragStartedRef.current || isEditing) {
      e.preventDefault()
      return
    }
    handleToggleExpanded()
  }

  useEffect(() => {
    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current)
      }
    }
  }, [])

  const handleStartEdit = () => {
    setIsEditing(true)
    setEditValue(folder.name)
  }

  const handleSaveEdit = async () => {
    if (!editValue.trim() || editValue.trim() === folder.name) {
      setIsEditing(false)
      setEditValue(folder.name)
      return
    }

    setIsRenaming(true)
    try {
      await updateFolderAPI(folder.id, { name: editValue.trim() })
      logger.info(`Successfully renamed folder from "${folder.name}" to "${editValue.trim()}"`)
      setIsEditing(false)
    } catch (error) {
      logger.error('Failed to rename folder:', {
        error,
        folderId: folder.id,
        oldName: folder.name,
        newName: editValue.trim(),
      })
      // Reset to original name on error
      setEditValue(folder.name)
    } finally {
      setIsRenaming(false)
    }
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditValue(folder.name)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancelEdit()
    }
  }

  const handleInputBlur = () => {
    handleSaveEdit()
  }

  const handleDelete = async () => {
    setShowDeleteDialog(true)
  }

  const confirmDelete = async () => {
    setIsDeleting(true)
    try {
      await deleteFolder(folder.id, workspaceId)
      setShowDeleteDialog(false)
    } catch (error) {
      logger.error('Failed to delete folder:', { error })
    } finally {
      setIsDeleting(false)
    }
  }

  if (isCollapsed) {
    return (
      <>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={clsx(
                'group mx-auto mb-1 flex h-9 w-9 cursor-pointer items-center justify-center',
                isDragging ? 'opacity-50' : ''
              )}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={handleClick}
              draggable={!isEditing}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <div
                className={clsx(
                  'flex h-4 w-4 items-center justify-center rounded transition-colors hover:bg-accent/50',
                  dragOver ? 'ring-2 ring-blue-500' : ''
                )}
              >
                {isExpanded ? (
                  <FolderOpen className='h-3 w-3 text-foreground/70 dark:text-foreground/60' />
                ) : (
                  <Folder className='h-3 w-3 text-foreground/70 dark:text-foreground/60' />
                )}
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side='right'>
            <p className='max-w-[200px] break-words'>{folder.name}</p>
          </TooltipContent>
        </Tooltip>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className='break-words'>
                Are you sure you want to delete "
                <span className='inline-block max-w-[200px] truncate align-bottom font-semibold'>
                  {folder.name}
                </span>
                "?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete the folder and all its contents, including subfolders
                and workflows. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDelete}
                disabled={isDeleting}
                className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
              >
                {isDeleting ? 'Deleting...' : 'Delete Forever'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    )
  }

  return (
    <>
      <div className='group mb-1' onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
        <div
          className={clsx(
            'flex h-9 cursor-pointer items-center rounded-lg px-2 py-2 text-sm transition-colors hover:bg-accent/50',
            isDragging ? 'opacity-50' : '',
            isFirstItem ? 'mr-[44px]' : ''
          )}
          style={{
            maxWidth: isFirstItem ? `${164 - level * 20}px` : `${206 - level * 20}px`,
          }}
          onClick={handleClick}
          draggable={!isEditing}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className='mr-2 flex h-4 w-4 flex-shrink-0 items-center justify-center'>
            {isExpanded ? (
              <FolderOpen className='h-4 w-4 text-foreground/70 dark:text-foreground/60' />
            ) : (
              <Folder className='h-4 w-4 text-foreground/70 dark:text-foreground/60' />
            )}
          </div>

          {isEditing ? (
            <Input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleInputBlur}
              className='h-6 flex-1 border-0 bg-transparent p-0 text-muted-foreground text-sm outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
              maxLength={50}
              disabled={isRenaming}
              onClick={(e) => e.stopPropagation()} // Prevent folder toggle when clicking input
            />
          ) : (
            <span className='flex-1 select-none truncate text-muted-foreground'>{folder.name}</span>
          )}

          {!isEditing && (
            <div className='flex items-center justify-center' onClick={(e) => e.stopPropagation()}>
              <FolderContextMenu
                folderId={folder.id}
                folderName={folder.name}
                onCreateWorkflow={onCreateWorkflow}
                onDelete={handleDelete}
                onStartEdit={handleStartEdit}
                level={level}
              />
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className='break-words'>
              Are you sure you want to delete "
              <span className='inline-block max-w-[200px] truncate align-bottom font-semibold'>
                {folder.name}
              </span>
              "?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the folder and all its contents, including subfolders and
              workflows. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={isDeleting}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              {isDeleting ? 'Deleting...' : 'Delete Forever'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
