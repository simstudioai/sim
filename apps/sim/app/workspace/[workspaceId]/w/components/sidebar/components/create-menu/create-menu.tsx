'use client'

import { useState } from 'react'
import { logger } from '@sentry/nextjs'
import { File, Folder, Plus } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useFolderStore } from '@/stores/folders/store'

interface CreateMenuProps {
  onCreateWorkflow: (folderId?: string) => void
  isCollapsed?: boolean
  isCreatingWorkflow?: boolean
}

export function CreateMenu({
  onCreateWorkflow,
  isCollapsed,
  isCreatingWorkflow = false,
}: CreateMenuProps) {
  const [showFolderDialog, setShowFolderDialog] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [isHoverOpen, setIsHoverOpen] = useState(false)

  const params = useParams()
  const workspaceId = params.workspaceId as string
  const { createFolder } = useFolderStore()

  const handleCreateWorkflow = () => {
    setIsHoverOpen(false)
    onCreateWorkflow()
  }

  const handleCreateFolder = () => {
    setIsHoverOpen(false)
    setShowFolderDialog(true)
  }

  const handleFolderSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!folderName.trim() || !workspaceId) return

    setIsCreating(true)
    try {
      await createFolder({
        name: folderName.trim(),
        workspaceId: workspaceId,
      })
      setFolderName('')
      setShowFolderDialog(false)
    } catch (error) {
      logger.error('Failed to create folder:', { error })
    } finally {
      setIsCreating(false)
    }
  }

  const handleCancel = () => {
    setFolderName('')
    setShowFolderDialog(false)
  }

  return (
    <>
      <Popover open={isHoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            className='h-6 w-6 shrink-0 p-0 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
            title='Create'
            onClick={handleCreateWorkflow}
            onMouseEnter={() => setIsHoverOpen(true)}
            onMouseLeave={() => setIsHoverOpen(false)}
            disabled={isCreatingWorkflow}
          >
            <Plus
              className={cn(
                'stroke-[2px]',
                isCollapsed ? 'h-[18px] w-[18px]' : 'h-[16px] w-[16px]'
              )}
            />
            <span className='sr-only'>Create</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align={isCollapsed ? 'center' : 'end'}
          side={isCollapsed ? 'right' : undefined}
          sideOffset={0}
          className={cn(
            'fade-in-0 zoom-in-95 data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
            'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
            'z-50 animate-in overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
            'data-[state=closed]:animate-out',
            'w-40'
          )}
          onMouseEnter={() => setIsHoverOpen(true)}
          onMouseLeave={() => setIsHoverOpen(false)}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <button
            className={cn(
              'flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors',
              isCreatingWorkflow
                ? 'cursor-not-allowed opacity-50'
                : 'hover:bg-accent hover:text-accent-foreground'
            )}
            onClick={handleCreateWorkflow}
            disabled={isCreatingWorkflow}
          >
            <File className='h-4 w-4' />
            {isCreatingWorkflow ? 'Creating...' : 'New Workflow'}
          </button>
          <button
            className='flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground'
            onClick={handleCreateFolder}
          >
            <Folder className='h-4 w-4' />
            New Folder
          </button>
        </PopoverContent>
      </Popover>

      {/* Folder creation dialog */}
      <Dialog open={showFolderDialog} onOpenChange={setShowFolderDialog}>
        <DialogContent className='sm:max-w-[425px]'>
          <DialogHeader>
            <DialogTitle>Create New Folder</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleFolderSubmit} className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='folder-name'>Folder Name</Label>
              <Input
                id='folder-name'
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder='Enter folder name...'
                autoFocus
                required
              />
            </div>
            <div className='flex justify-end space-x-2'>
              <Button type='button' variant='outline' onClick={handleCancel}>
                Cancel
              </Button>
              <Button type='submit' disabled={!folderName.trim() || isCreating}>
                {isCreating ? 'Creating...' : 'Create Folder'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
