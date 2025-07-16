'use client'

import { MoreHorizontal, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/w/components/providers/workspace-permissions-provider'

interface WorkflowContextMenuProps {
  onStartEdit?: () => void
}

export function WorkflowContextMenu({ onStartEdit }: WorkflowContextMenuProps) {
  // Get user permissions for the workspace
  const userPermissions = useUserPermissionsContext()

  const handleRename = () => {
    if (onStartEdit) {
      onStartEdit()
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant='ghost'
          size='icon'
          className='h-4 w-4 p-0 opacity-0 transition-opacity hover:bg-transparent focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0 group-hover:opacity-100'
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className='h-3 w-3' />
          <span className='sr-only'>Workflow options</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='end'
        onClick={(e) => e.stopPropagation()}
        className='min-w-32 rounded-lg border-[#E5E5E5] bg-[#FFFFFF] shadow-xs dark:border-[#414141] dark:bg-[#202020]'
      >
        {userPermissions.canEdit && (
          <DropdownMenuItem
            onClick={handleRename}
            className='cursor-pointer rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
          >
            <Pencil className='mr-2 h-4 w-4' />
            Rename
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
