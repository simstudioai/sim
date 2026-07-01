'use client'

import { useId, useState } from 'react'
import { Checkbox, ChevronDown, cn } from '@sim/emcn'

export interface ForkFileTreeItem {
  id: string
  label: string
}

export interface ForkFileTreeFolder {
  id: string
  name: string
  files: ForkFileTreeItem[]
}

/** A flat copyable file with its folder grouping, before {@link groupForkFilesIntoFolders}. */
export interface ForkFlatFile {
  id: string
  label: string
  folderId: string | null
  folderName: string | null
}

/**
 * Group flat files into folders (sorted by name, each file sorted by label) plus a root bucket
 * for files with no folder. A file whose folder id is set but whose name is null (its folder was
 * deleted) falls into the root bucket, so it stays selectable rather than hiding under a phantom.
 */
export function groupForkFilesIntoFolders(files: ForkFlatFile[]): {
  folders: ForkFileTreeFolder[]
  rootFiles: ForkFileTreeItem[]
} {
  const folderById = new Map<string, ForkFileTreeFolder>()
  const rootFiles: ForkFileTreeItem[] = []
  for (const file of files) {
    const item: ForkFileTreeItem = { id: file.id, label: file.label }
    if (file.folderId && file.folderName) {
      let folder = folderById.get(file.folderId)
      if (!folder) {
        folder = { id: file.folderId, name: file.folderName, files: [] }
        folderById.set(file.folderId, folder)
      }
      folder.files.push(item)
    } else {
      rootFiles.push(item)
    }
  }
  const folders = Array.from(folderById.values()).sort((a, b) => a.name.localeCompare(b.name))
  for (const folder of folders) folder.files.sort((a, b) => a.label.localeCompare(b.label))
  rootFiles.sort((a, b) => a.label.localeCompare(b.label))
  return { folders, rootFiles }
}

interface ForkFileTreeProps {
  folders: ForkFileTreeFolder[]
  rootFiles: ForkFileTreeItem[]
  isSelected: (fileId: string) => boolean
  onToggleFile: (fileId: string, checked: boolean) => void
  /** Toggle every file in a folder at once (the folder-level select-all). */
  onToggleMany: (fileIds: string[], checked: boolean) => void
  disabled?: boolean
}

/**
 * Folder ▸ file collapsible tree shared by the fork picker and the sync copy selector, so both
 * surfaces group files identically. Each folder is a tri-state select-all header that expands to
 * its files; files with no folder render at the top level. Files are the only copyable kind that
 * nests - tables, knowledge bases, custom tools, and skills stay flat at the top level.
 */
export function ForkFileTree({
  folders,
  rootFiles,
  isSelected,
  onToggleFile,
  onToggleMany,
  disabled = false,
}: ForkFileTreeProps) {
  return (
    <div className='flex flex-col gap-1'>
      {folders.map((folder) => (
        <ForkFileFolderRow
          key={folder.id}
          folder={folder}
          isSelected={isSelected}
          onToggleFile={onToggleFile}
          onToggleMany={onToggleMany}
          disabled={disabled}
        />
      ))}
      {rootFiles.map((file) => (
        <ForkFileRow
          key={file.id}
          file={file}
          checked={isSelected(file.id)}
          onToggle={onToggleFile}
          disabled={disabled}
        />
      ))}
    </div>
  )
}

interface ForkFileFolderRowProps {
  folder: ForkFileTreeFolder
  isSelected: (fileId: string) => boolean
  onToggleFile: (fileId: string, checked: boolean) => void
  onToggleMany: (fileIds: string[], checked: boolean) => void
  disabled: boolean
}

function ForkFileFolderRow({
  folder,
  isSelected,
  onToggleFile,
  onToggleMany,
  disabled,
}: ForkFileFolderRowProps) {
  const [expanded, setExpanded] = useState(false)
  const fileIds = folder.files.map((file) => file.id)
  const total = fileIds.length
  const selectedCount = fileIds.filter(isSelected).length
  const headerState = selectedCount === 0 ? false : selectedCount === total ? true : 'indeterminate'

  return (
    <div className='flex flex-col gap-1'>
      <div className='flex items-center gap-2 text-[var(--text-body)] text-sm'>
        <Checkbox
          size='sm'
          aria-label={`Copy all in ${folder.name}`}
          checked={headerState}
          onCheckedChange={() => onToggleMany(fileIds, headerState !== true)}
          disabled={disabled}
        />
        <button
          type='button'
          className='flex min-w-0 flex-1 items-center gap-1 text-left hover:text-[var(--text-primary)]'
          onClick={() => setExpanded((value) => !value)}
        >
          <span className='min-w-0 flex-1 truncate'>
            {folder.name} ({selectedCount > 0 ? `${selectedCount}/${total}` : total})
          </span>
          <ChevronDown
            className={cn(
              'h-[6px] w-[10px] flex-shrink-0 text-[var(--text-icon)] transition-transform',
              expanded && 'rotate-180'
            )}
          />
        </button>
      </div>
      {expanded ? (
        <div className='ml-6 flex flex-col gap-0.5'>
          {folder.files.map((file) => (
            <ForkFileRow
              key={file.id}
              file={file}
              checked={isSelected(file.id)}
              onToggle={onToggleFile}
              disabled={disabled}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

interface ForkFileRowProps {
  file: ForkFileTreeItem
  checked: boolean
  onToggle: (fileId: string, checked: boolean) => void
  disabled: boolean
}

function ForkFileRow({ file, checked, onToggle, disabled }: ForkFileRowProps) {
  const itemId = useId()
  return (
    <label
      htmlFor={itemId}
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-md py-0.5 text-[var(--text-body)] text-sm',
        disabled
          ? 'cursor-not-allowed opacity-60'
          : 'cursor-pointer hover:text-[var(--text-primary)]'
      )}
    >
      <Checkbox
        id={itemId}
        size='sm'
        checked={checked}
        onCheckedChange={(value) => onToggle(file.id, value === true)}
        disabled={disabled}
      />
      <span className='min-w-0 flex-1 truncate'>{file.label}</span>
    </label>
  )
}
