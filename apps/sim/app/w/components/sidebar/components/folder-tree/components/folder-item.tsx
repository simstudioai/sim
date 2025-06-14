'use client'

import clsx from 'clsx'
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { type FolderTreeNode, useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
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
  const { expandedFolders, toggleExpanded, updateFolderAPI, deleteFolder, selectedWorkflows } =
    useFolderStore()
  const { updateWorkflow } = useWorkflowRegistry()

  const isExpanded = expandedFolders.has(folder.id)

  const handleToggleExpanded = () => {
    toggleExpanded(folder.id)
    updateFolderAPI(folder.id, { isExpanded: !isExpanded }).catch(console.error)
  }

  const handleRename = async (folderId: string, newName: string) => {
    try {
      await updateFolderAPI(folderId, { name: newName })
    } catch (error) {
      console.error('Failed to rename folder:', error)
    }
  }

  const handleDelete = async (folderId: string) => {
    if (
      confirm(
        `Are you sure you want to delete "${folder.name}"? Child folders and workflows will be moved to the parent folder.`
      )
    ) {
      try {
        await deleteFolder(folderId)
      } catch (error) {
        console.error('Failed to delete folder:', error)
      }
    }
  }

  if (isCollapsed) {
    return (
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
    )
  }

  return (
    <div className='group' onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div
        className='flex cursor-pointer items-center rounded-md px-2 py-1.5 text-sm hover:bg-accent/50'
        onClick={handleToggleExpanded}
      >
        <div className='mr-1 flex h-4 w-4 items-center justify-center'>
          {isExpanded ? <ChevronDown className='h-3 w-3' /> : <ChevronRight className='h-3 w-3' />}
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
  )
}
