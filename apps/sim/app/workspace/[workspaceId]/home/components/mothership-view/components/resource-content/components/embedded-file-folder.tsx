'use client'

import { Button, OverflowText } from '@sim/emcn'
import { File as FileIcon, Folder as FolderIcon } from '@sim/emcn/icons'
import { folderedResourceListHref } from '@/app/workspace/[workspaceId]/components/folders/foldered-resources'
import { useWorkspaceFileFolders } from '@/hooks/queries/workspace-file-folders'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'

interface EmbeddedFileFolderProps {
  workspaceId: string
  folderId: string
  onOpen: (href: string) => void
}

/** Uses the ordinary file browser queries and destinations inside the chat resource panel. */
export function EmbeddedFileFolder({ workspaceId, folderId, onOpen }: EmbeddedFileFolderProps) {
  const folders = useWorkspaceFileFolders(workspaceId)
  const files = useWorkspaceFiles(workspaceId)

  if (folders.error || files.error) {
    return (
      <div role='alert' className='flex h-full flex-col items-center justify-center gap-3 p-6'>
        <p>Unable to load this folder</p>
        <Button
          onClick={() => {
            void folders.refetch()
            void files.refetch()
          }}
        >
          Try again
        </Button>
      </div>
    )
  }
  if (
    folders.isPending ||
    files.isPending ||
    folders.isPlaceholderData ||
    files.isPlaceholderData
  ) {
    return (
      <div role='status' className='p-6 text-[var(--text-muted)]'>
        Loading folder…
      </div>
    )
  }

  const folder = folders.data?.find((item) => item.id === folderId)
  if (!folder) {
    return <div className='p-6 text-[var(--text-muted)]'>Folder not found</div>
  }
  const children = folders.data?.filter((item) => item.parentId === folderId) ?? []
  const documents = files.data?.filter((file) => file.folderId === folderId) ?? []
  const itemClass =
    'flex items-center gap-2 rounded-[6px] px-3 py-2 text-left transition-colors hover:bg-[var(--surface-4)]'

  return (
    <div className='flex h-full flex-col overflow-y-auto p-6'>
      <div className='mb-4 flex items-center justify-between gap-3'>
        <h2 className='text-[16px] text-[var(--text-primary)]'>{folder.name}</h2>
        <Button onClick={() => onOpen(folderedResourceListHref('file', workspaceId, folderId))}>
          Open folder
        </Button>
      </div>
      {children.length === 0 && documents.length === 0 ? (
        <p className='text-[13px] text-[var(--text-muted)]'>This folder is empty</p>
      ) : (
        <div className='flex flex-col gap-1'>
          {children.map((child) => (
            <button
              key={child.id}
              type='button'
              className={itemClass}
              onClick={() => onOpen(folderedResourceListHref('file', workspaceId, child.id))}
            >
              <FolderIcon className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
              <OverflowText label={child.name} className='text-[var(--text-primary)] text-small' />
            </button>
          ))}
          {documents.map((file) => (
            <button
              key={file.id}
              type='button'
              className={itemClass}
              onClick={() => onOpen(`/workspace/${workspaceId}/files/${file.id}`)}
            >
              <FileIcon className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
              <OverflowText label={file.name} className='text-[var(--text-primary)] text-small' />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
