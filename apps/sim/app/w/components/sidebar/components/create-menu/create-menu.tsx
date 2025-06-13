'use client'

import { useState } from 'react'
import { File, Folder, Plus } from 'lucide-react'
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
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface CreateMenuProps {
  onCreateWorkflow: (folderId?: string) => void
  isCollapsed?: boolean
}

export function CreateMenu({ onCreateWorkflow, isCollapsed }: CreateMenuProps) {
  const [showFolderDialog, setShowFolderDialog] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const { activeWorkspaceId } = useWorkflowRegistry()
  const { createFolder } = useFolderStore()

  const handleCreateWorkflow = () => {
    onCreateWorkflow()
  }

  const handleCreateFolder = () => {
    setShowFolderDialog(true)
  }

  const handleFolderSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!folderName.trim() || !activeWorkspaceId) return

    setIsCreating(true)
    try {
      await createFolder({
        name: folderName.trim(),
        workspaceId: activeWorkspaceId,
      })
      setFolderName('')
      setShowFolderDialog(false)
    } catch (error) {
      console.error('Failed to create folder:', error)
      // You could add toast notification here
    } finally {
      setIsCreating(false)
    }
  }

  const handleCancel = () => {
    setFolderName('')
    setShowFolderDialog(false)
  }

  if (isCollapsed) {
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='ghost' size='icon' className='h-6 w-6 shrink-0 p-0' title='Create'>
              <Plus className='h-[18px] w-[18px] stroke-[2px]' />
              <span className='sr-only'>Create</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='center' side='right'>
            <DropdownMenuItem onClick={handleCreateWorkflow}>
              <File className='mr-2 h-4 w-4' />
              New Workflow
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleCreateFolder}>
              <Folder className='mr-2 h-4 w-4' />
              New Folder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

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

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' size='icon' className='h-6 w-6 shrink-0 p-0' title='Create'>
            <Plus className='h-[16px] w-[16px] stroke-[2px]' />
            <span className='sr-only'>Create</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem onClick={handleCreateWorkflow}>
            <File className='mr-2 h-4 w-4' />
            New Workflow
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleCreateFolder}>
            <Folder className='mr-2 h-4 w-4' />
            New Folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
