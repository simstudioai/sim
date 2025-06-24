'use client'

import { useState } from 'react'
import { File, Folder, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface FolderContextMenuProps {
  folderId: string
  folderName: string
  onCreateWorkflow: (folderId: string) => void
  onRename?: (folderId: string, newName: string) => void
  onDelete?: (folderId: string) => void
}

export function FolderContextMenu({
  folderId,
  folderName,
  onCreateWorkflow,
  onRename,
  onDelete,
}: FolderContextMenuProps) {
  const [showSubfolderDialog, setShowSubfolderDialog] = useState(false)
  const [showRenameDialog, setShowRenameDialog] = useState(false)
  const [subfolderName, setSubfolderName] = useState('')
  const [renameName, setRenameName] = useState(folderName)
  const [isCreating, setIsCreating] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)

  const { activeWorkspaceId } = useWorkflowRegistry()
  const { createFolder, updateFolder, deleteFolder } = useFolderStore()

  const handleCreateWorkflow = () => {
    onCreateWorkflow(folderId)
  }

  const handleCreateSubfolder = () => {
    setShowSubfolderDialog(true)
  }

  const handleRename = () => {
    setRenameName(folderName)
    setShowRenameDialog(true)
  }

  const handleDelete = () => {
    if (onDelete) {
      onDelete(folderId)
    } else {
      // Default delete behavior
      deleteFolder(folderId)
    }
  }

  const handleSubfolderSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!subfolderName.trim() || !activeWorkspaceId) return

    setIsCreating(true)
    try {
      await createFolder({
        name: subfolderName.trim(),
        workspaceId: activeWorkspaceId,
        parentId: folderId,
      })
      setSubfolderName('')
      setShowSubfolderDialog(false)
    } catch (error) {
      console.error('Failed to create subfolder:', error)
    } finally {
      setIsCreating(false)
    }
  }

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!renameName.trim()) return

    setIsRenaming(true)
    try {
      if (onRename) {
        onRename(folderId, renameName.trim())
      } else {
        // Default rename behavior
        await updateFolder(folderId, { name: renameName.trim() })
      }
      setShowRenameDialog(false)
    } catch (error) {
      console.error('Failed to rename folder:', error)
    } finally {
      setIsRenaming(false)
    }
  }

  const handleCancel = () => {
    setSubfolderName('')
    setShowSubfolderDialog(false)
    setRenameName(folderName)
    setShowRenameDialog(false)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            className='h-4 w-4 p-0 opacity-0 transition-opacity group-hover:opacity-100'
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className='h-3 w-3' />
            <span className='sr-only'>Folder options</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onClick={handleCreateWorkflow}>
            <File className='mr-2 h-4 w-4' />
            New Workflow
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleCreateSubfolder}>
            <Folder className='mr-2 h-4 w-4' />
            New Subfolder
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleRename}>
            <Pencil className='mr-2 h-4 w-4' />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleDelete} className='text-destructive'>
            <Trash2 className='mr-2 h-4 w-4' />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Subfolder creation dialog */}
      <Dialog open={showSubfolderDialog} onOpenChange={setShowSubfolderDialog}>
        <DialogContent className='sm:max-w-[425px]' onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Create New Subfolder</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubfolderSubmit} className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='subfolder-name'>Folder Name</Label>
              <Input
                id='subfolder-name'
                value={subfolderName}
                onChange={(e) => setSubfolderName(e.target.value)}
                placeholder='Enter folder name...'
                autoFocus
                required
              />
            </div>
            <div className='flex justify-end space-x-2'>
              <Button type='button' variant='outline' onClick={handleCancel}>
                Cancel
              </Button>
              <Button type='submit' disabled={!subfolderName.trim() || isCreating}>
                {isCreating ? 'Creating...' : 'Create Folder'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <DialogContent className='sm:max-w-[425px]' onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Rename Folder</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRenameSubmit} className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='rename-folder'>Folder Name</Label>
              <Input
                id='rename-folder'
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                placeholder='Enter folder name...'
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
