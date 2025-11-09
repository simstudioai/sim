'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Folder, FolderOpen, Pencil, Trash2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Tooltip } from '@/components/emcn'
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
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console/logger'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { type FolderTreeNode, useFolderStore } from '@/stores/folders/store'

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
  const [isDragging, setIsDragging] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(folder.name)
  const [isRenaming, setIsRenaming] = useState(false)
  const [isHovered, setIsHovered] = useState(false)

  const dragStartedRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const isExpanded = expandedFolders.has(folder.id)
  const userPermissions = useUserPermissionsContext()

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
    toggleExpanded(folder.id)
  }, [folder.id, toggleExpanded, isEditing])

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
    setShowDeleteDialog(false)

    try {
      await deleteFolder(folder.id, workspaceId)
    } catch (error) {
      logger.error('Failed to delete folder:', { error })
    }
  }

  if (isCollapsed) {
    return (
      <>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <div
              className={clsx(
                'group mx-auto mb-1 flex h-8 w-8 cursor-pointer items-center justify-center',
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
                  'relative flex h-[14px] w-[14px] items-center justify-center rounded transition-colors hover:bg-muted',
                  dragOver &&
                    'before:pointer-events-none before:absolute before:inset-0 before:rounded before:bg-muted/20 before:ring-2 before:ring-muted-foreground/60'
                )}
              >
                {isExpanded ? (
                  <FolderOpen className='h-[14px] w-[14px] text-foreground/70 group-hover:text-foreground dark:text-foreground/60' />
                ) : (
                  <Folder className='h-[14px] w-[14px] text-foreground/70 group-hover:text-foreground dark:text-foreground/60' />
                )}
              </div>
            </div>
          </Tooltip.Trigger>
          <Tooltip.Content side='right'>
            <p className='max-w-[200px] break-words'>{folder.name}</p>
          </Tooltip.Content>
        </Tooltip.Root>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete folder?</AlertDialogTitle>
              <AlertDialogDescription>
                Deleting this folder will permanently remove all associated workflows, logs, and
                knowledge bases.{' '}
                <span className='text-red-500 dark:text-red-500'>
                  This action cannot be undone.
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter className='flex'>
              <AlertDialogCancel className='h-9 w-full rounded-[8px]'>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDelete}
                className='h-9 w-full rounded-[8px] bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    )
  }

  return (
    <>
      <div className='mb-1' onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
        <div
          className={clsx(
            'group flex h-8 cursor-pointer items-center rounded-[8px] px-2 py-2 font-medium font-sans text-sm transition-colors hover:bg-muted',
            isDragging ? 'opacity-50' : '',
            isFirstItem ? 'mr-[36px]' : ''
          )}
          style={{
            maxWidth: isFirstItem ? `${166 - level * 20}px` : `${206 - level * 20}px`,
          }}
          onClick={handleClick}
          draggable={!isEditing}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <div className='mr-2 flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center'>
            {isExpanded ? (
              <FolderOpen className='h-[14px] w-[14px] text-foreground/70 group-hover:text-foreground dark:text-foreground/60' />
            ) : (
              <Folder className='h-[14px] w-[14px] text-foreground/70 group-hover:text-foreground dark:text-foreground/60' />
            )}
          </div>

          {isEditing ? (
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleInputBlur}
              className={clsx(
                'min-w-0 flex-1 border-0 bg-transparent p-0 font-medium text-sm outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
                'text-muted-foreground group-hover:text-foreground'
              )}
              maxLength={50}
              disabled={isRenaming}
              onClick={(e) => e.stopPropagation()} // Prevent folder toggle when clicking input
              autoComplete='off'
              autoCorrect='off'
              autoCapitalize='off'
              spellCheck='false'
            />
          ) : (
            <span
              className={clsx(
                'min-w-0 flex-1 select-none truncate pr-1 font-medium text-sm',
                'text-muted-foreground group-hover:text-foreground'
              )}
            >
              {folder.name}
            </span>
          )}

          {!isEditing && isHovered && userPermissions.canEdit && (
            <div
              className='flex items-center justify-center gap-1'
              onClick={(e) => e.stopPropagation()}
            >
              <Button
                variant='ghost'
                size='icon'
                className='h-4 w-4 p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground'
                onClick={(e) => {
                  e.stopPropagation()
                  handleStartEdit()
                }}
              >
                <Pencil className='!h-3.5 !w-3.5' />
                <span className='sr-only'>Rename folder</span>
              </Button>
              <Button
                variant='ghost'
                size='icon'
                className='h-4 w-4 p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground'
                onClick={(e) => {
                  e.stopPropagation()
                  handleDelete()
                }}
              >
                <Trash2 className='!h-3.5 !w-3.5' />
                <span className='sr-only'>Delete folder</span>
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder?</AlertDialogTitle>
            <AlertDialogDescription>
              Deleting this folder will permanently remove all associated workflows, logs, and
              knowledge bases.{' '}
              <span className='text-red-500 dark:text-red-500'>This action cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter className='flex'>
            <AlertDialogCancel className='h-9 w-full rounded-[8px]'>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className='h-9 w-full rounded-[8px] bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
