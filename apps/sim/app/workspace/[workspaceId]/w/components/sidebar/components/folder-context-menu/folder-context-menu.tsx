'use client'

import { useState } from 'react'
import { File, Folder, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console/logger'
import { generateSubfolderName } from '@/lib/naming'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/components/providers/workspace-permissions-provider'
import { useFolderStore } from '@/stores/folders/store'

const logger = createLogger('FolderContextMenu')

interface FolderContextMenuProps {
  folderId: string
  folderName: string
  onCreateWorkflow: (folderId: string) => void
  onDelete?: (folderId: string) => void
  onStartEdit?: () => void
  level: number
}

export function FolderContextMenu({
  folderId,
  folderName,
  onCreateWorkflow,
  onDelete,
  onStartEdit,
  level,
}: FolderContextMenuProps) {
  const [isCreating, setIsCreating] = useState(false)
  const params = useParams()
  const workspaceId = params.workspaceId as string

  // Get user permissions for the workspace
  const userPermissions = useUserPermissionsContext()

  const { createFolder, deleteFolder, setExpanded } = useFolderStore()

  const handleCreateWorkflow = () => {
    // Ensure folder is expanded so user can see the new workflow
    setExpanded(folderId, true)
    onCreateWorkflow(folderId)
  }

  const handleCreateSubfolder = async () => {
    if (isCreating) {
      logger.info('Subfolder creation already in progress, ignoring request')
      return
    }

    if (!workspaceId) {
      logger.error('No workspaceId available for subfolder creation')
      return
    }

    try {
      setIsCreating(true)

      // Ensure parent folder is expanded so user can see the new subfolder
      setExpanded(folderId, true)

      // Generate subfolder name using fresh data from API
      const subfolderName = await generateSubfolderName(workspaceId, folderId)

      await createFolder({
        name: subfolderName,
        workspaceId: workspaceId,
        parentId: folderId,
      })

      logger.info(`Created subfolder: ${subfolderName}`)
    } catch (error) {
      logger.error('Failed to create subfolder:', { error })
    } finally {
      setIsCreating(false)
    }
  }

  const handleRename = () => {
    if (onStartEdit) {
      onStartEdit()
    }
  }

  const handleDelete = async () => {
    if (onDelete) {
      onDelete(folderId)
    } else {
      // Default delete behavior with proper error handling
      try {
        await deleteFolder(folderId, workspaceId)
        logger.info(`Successfully deleted folder from context menu: ${folderName}`)
      } catch (error) {
        logger.error('Failed to delete folder from context menu:', { error, folderId, folderName })
      }
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            className='h-4 w-4 p-0 opacity-0 transition-opacity hover:bg-transparent focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0 group-hover:opacity-100'
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className='h-3 w-3' />
            <span className='sr-only'>Folder options</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align='end'
          onClick={(e) => e.stopPropagation()}
          className='min-w-32 rounded-lg border-[#E5E5E5] bg-[#FFFFFF] shadow-xs dark:border-[#414141] dark:bg-[#202020]'
        >
          {userPermissions.canEdit && (
            <>
              <DropdownMenuItem
                onClick={handleCreateWorkflow}
                className='cursor-pointer rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
              >
                <File className='mr-2 h-4 w-4' />
                New Workflow
              </DropdownMenuItem>
              {level === 0 && (
                <DropdownMenuItem
                  onClick={handleCreateSubfolder}
                  className='cursor-pointer rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
                >
                  <Folder className='mr-2 h-4 w-4' />
                  New Subfolder
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={handleRename}
                className='cursor-pointer rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
              >
                <Pencil className='mr-2 h-4 w-4' />
                Rename
              </DropdownMenuItem>
            </>
          )}
          {userPermissions.canAdmin ? (
            <DropdownMenuItem
              onClick={handleDelete}
              className='cursor-pointer rounded-md px-3 py-2 font-[380] text-destructive text-sm hover:bg-destructive/10 focus:bg-destructive/10 focus:text-destructive'
            >
              <Trash2 className='mr-2 h-4 w-4' />
              Delete
            </DropdownMenuItem>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <DropdownMenuItem
                    className='cursor-not-allowed rounded-md px-3 py-2 font-[380] text-muted-foreground text-sm opacity-50'
                    onClick={(e) => e.preventDefault()}
                  >
                    <Trash2 className='mr-2 h-4 w-4' />
                    Delete
                  </DropdownMenuItem>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Admin access required to delete folders</p>
              </TooltipContent>
            </Tooltip>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
