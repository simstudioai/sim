'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { type FolderTreeNode, useFolderStore } from '@/stores/folders/store'
import { FolderContextMenu } from '../../folder-context-menu/folder-context-menu'

interface FolderItemProps {
  folder: FolderTreeNode
  isCollapsed?: boolean
  onCreateWorkflow: (folderId?: string) => void
  dragOver?: boolean
  onDragOver?: (e: React.DragEvent) => void
  onDragLeave?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
}

export function FolderItem({
  folder,
  isCollapsed,
  onCreateWorkflow,
  dragOver = false,
  onDragOver,
  onDragLeave,
  onDrop,
}: FolderItemProps) {
  const { expandedFolders, toggleExpanded, updateFolderAPI, deleteFolder } = useFolderStore()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const isExpanded = expandedFolders.has(folder.id)
  const updateTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pendingStateRef = useRef<boolean | null>(null)

  const handleToggleExpanded = useCallback(() => {
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
  }, [folder.id, isExpanded, toggleExpanded, updateFolderAPI])

  useEffect(() => {
    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current)
      }
    }
  }, [])

  const handleRename = async (folderId: string, newName: string) => {
    try {
      await updateFolderAPI(folderId, { name: newName })
    } catch (error) {
      console.error('Failed to rename folder:', error)
    }
  }

  const handleDelete = async (folderId: string) => {
    setShowDeleteDialog(true)
  }

  const confirmDelete = async () => {
    setIsDeleting(true)
    try {
      await deleteFolder(folder.id)
      setShowDeleteDialog(false)
    } catch (error) {
      console.error('Failed to delete folder:', error)
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
              className='group mx-auto flex h-8 w-8 cursor-pointer items-center justify-center'
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={handleToggleExpanded}
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
            <p>{folder.name}</p>
          </TooltipContent>
        </Tooltip>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure you want to delete "{folder.name}"?</AlertDialogTitle>
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
      <div className='group' onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
        <div
          className='flex cursor-pointer items-center rounded-md px-2 py-1.5 text-sm hover:bg-accent/50'
          onClick={handleToggleExpanded}
        >
          <div className='mr-1 flex h-4 w-4 items-center justify-center'>
            {isExpanded ? (
              <ChevronDown className='h-3 w-3' />
            ) : (
              <ChevronRight className='h-3 w-3' />
            )}
          </div>

          <div className='mr-2 flex h-4 w-4 flex-shrink-0 items-center justify-center'>
            {isExpanded ? (
              <FolderOpen className='h-4 w-4 text-foreground/70 dark:text-foreground/60' />
            ) : (
              <Folder className='h-4 w-4 text-foreground/70 dark:text-foreground/60' />
            )}
          </div>

          <span className='flex-1 cursor-default select-none truncate text-muted-foreground'>
            {folder.name}
          </span>

          <div className='flex items-center justify-center' onClick={(e) => e.stopPropagation()}>
            <FolderContextMenu
              folderId={folder.id}
              folderName={folder.name}
              onCreateWorkflow={onCreateWorkflow}
              onRename={handleRename}
              onDelete={handleDelete}
            />
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure you want to delete "{folder.name}"?</AlertDialogTitle>
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
