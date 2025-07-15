'use client'

import { useState } from 'react'
import { MoreHorizontal, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createLogger } from '@/lib/logs/console-logger'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/w/components/providers/workspace-permissions-provider'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

const logger = createLogger('WorkflowContextMenu')

interface WorkflowContextMenuProps {
  workflow: WorkflowMetadata
  onRename?: (workflowId: string, newName: string) => void
  level: number
}

export function WorkflowContextMenu({ workflow, onRename, level }: WorkflowContextMenuProps) {
  const [showRenameDialog, setShowRenameDialog] = useState(false)
  const [renameName, setRenameName] = useState(workflow.name)
  const [isRenaming, setIsRenaming] = useState(false)

  // Get user permissions for the workspace
  const userPermissions = useUserPermissionsContext()

  const { updateWorkflow } = useWorkflowRegistry()

  const handleRename = () => {
    setRenameName(workflow.name)
    setShowRenameDialog(true)
  }

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!renameName.trim()) return

    setIsRenaming(true)
    try {
      if (onRename) {
        onRename(workflow.id, renameName.trim())
      } else {
        // Default rename behavior using updateWorkflow
        await updateWorkflow(workflow.id, { name: renameName.trim() })
        logger.info(
          `Successfully renamed workflow from "${workflow.name}" to "${renameName.trim()}"`
        )
      }
      setShowRenameDialog(false)
    } catch (error) {
      logger.error('Failed to rename workflow:', {
        error,
        workflowId: workflow.id,
        oldName: workflow.name,
        newName: renameName.trim(),
      })
    } finally {
      setIsRenaming(false)
    }
  }

  const handleCancel = () => {
    setRenameName(workflow.name)
    setShowRenameDialog(false)
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

      {/* Rename dialog */}
      <Dialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <DialogContent className='sm:max-w-[425px]' onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Rename Workflow</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRenameSubmit} className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='rename-workflow'>Workflow Name</Label>
              <Input
                id='rename-workflow'
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                placeholder='Enter workflow name...'
                maxLength={100}
                autoFocus
                required
              />
            </div>
            <div className='flex justify-end space-x-2'>
              <Button type='button' variant='outline' onClick={handleCancel}>
                Cancel
              </Button>
              <Button type='submit' disabled={!renameName.trim() || isRenaming}>
                {isRenaming ? 'Renaming...' : 'Rename'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
