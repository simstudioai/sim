'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  ChevronDown,
  chipFieldSurfaceClass,
  chipFieldTextClass,
  chipHoverSurfaceClass,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@sim/emcn'
import { Check, X } from '@sim/emcn/icons'
import { useParams } from 'next/navigation'
import type { FolderResourceType } from '@/lib/api/contracts/folders'
import { readFolderPath } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/sim-folder-tree-selector/selection'
import {
  type ResourceFolder,
  useResourceFolders,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-resource-folders'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'

interface SimFolderTreeSelectorProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: unknown
}

/**
 * Picks one workspace folder and stores its canonical percent-encoded path —
 * the value every folder tool accepts, so the picker never reaches the backend.
 *
 * It behaves like a select rather than a tree of checkboxes: the row is the
 * click target, the chosen one carries a check, and choosing closes the
 * popover. The chevron beside a row with children expands it, and is a separate
 * button so a click on the name always picks rather than navigates.
 *
 * There is deliberately no "workspace root" row. Root is the absence of a
 * selection, which is what the placeholder says: create and move read an unset
 * parent as the root, delete and list require a real folder, and read treats it
 * as "no folder scope". A root row would be meaningless or wrong on each.
 */
export function SimFolderTreeSelector({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
}: SimFolderTreeSelectorProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const resourceType = (subBlock.resourceType as FolderResourceType | undefined) ?? 'file'

  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlock.id)
  const selected = readFolderPath(isPreview ? previewValue : storeValue)
  const [open, setOpen] = useState(false)

  const { folders, isLoading } = useResourceFolders(workspaceId, resourceType)

  const foldersByParent = useMemo(() => {
    const grouped = new Map<string | null, ResourceFolder[]>()
    for (const folder of folders) {
      const bucket = grouped.get(folder.parentId)
      if (bucket) bucket.push(folder)
      else grouped.set(folder.parentId, [folder])
    }
    for (const bucket of grouped.values()) {
      bucket.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    }
    return grouped
  }, [folders])

  const folderByPath = useMemo(
    () => new Map(folders.map((folder) => [folder.path, folder])),
    [folders]
  )

  const select = useCallback(
    (folder: ResourceFolder) => {
      if (isPreview) return
      setStoreValue(selected === folder.path ? '' : folder.path)
      setOpen(false)
    },
    [isPreview, selected, setStoreValue]
  )

  const clear = useCallback(() => {
    if (isPreview) return
    setStoreValue('')
  }, [isPreview, setStoreValue])

  const roots = foldersByParent.get(null) ?? []
  const label = selected ? (folderByPath.get(selected)?.name ?? selected) : null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type='button'
          disabled={disabled || isPreview}
          className={cn(
            chipFieldSurfaceClass,
            chipFieldTextClass,
            'flex min-h-[30px] w-full items-center gap-1 px-2 py-1 text-left',
            disabled || isPreview ? 'cursor-not-allowed opacity-60' : chipHoverSurfaceClass
          )}
        >
          <span
            className={cn(
              'min-w-0 flex-1 truncate',
              label ? undefined : 'text-[var(--text-placeholder)]'
            )}
          >
            {label ?? subBlock.placeholder ?? 'Select a folder'}
          </span>
          {label ? (
            <X
              aria-label='Clear selected folder'
              className='size-[12px] shrink-0 text-[var(--text-icon)] hover:text-[var(--text-primary)]'
              onClick={(event) => {
                event.stopPropagation()
                clear()
              }}
            />
          ) : null}
          <ChevronDown className='size-[14px] shrink-0 text-[var(--text-icon)]' />
        </button>
      </PopoverTrigger>

      {/* Pinned to the trigger width the way Combobox does, so the panel reads as one control. */}
      <PopoverContent
        align='start'
        className='max-h-[320px] w-[var(--radix-popover-trigger-width)] overflow-y-auto p-2'
      >
        {isLoading ? (
          <p className='text-[var(--text-muted)] text-caption'>Loading folders…</p>
        ) : roots.length === 0 ? (
          <p className='text-[var(--text-muted)] text-caption'>No folders yet</p>
        ) : (
          <div className='flex flex-col gap-1'>
            {roots.map((folder) => (
              <FolderRow
                key={folder.id}
                folder={folder}
                foldersByParent={foldersByParent}
                selected={selected}
                onSelect={select}
              />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

interface FolderRowProps {
  folder: ResourceFolder
  foldersByParent: Map<string | null, ResourceFolder[]>
  selected: string
  onSelect: (folder: ResourceFolder) => void
}

function FolderRow({ folder, foldersByParent, selected, onSelect }: FolderRowProps) {
  const [open, setOpen] = useState(false)
  const children = foldersByParent.get(folder.id) ?? []
  const isSelected = selected === folder.path

  return (
    <div className='flex flex-col gap-1'>
      <div className='flex min-w-0 items-center gap-2 text-small'>
        <button
          type='button'
          aria-pressed={isSelected}
          onClick={() => onSelect(folder)}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1 text-left transition-colors hover:text-[var(--text-primary)]',
            isSelected ? 'text-[var(--text-primary)]' : 'text-[var(--text-body)]'
          )}
        >
          <span className='min-w-0 flex-1 truncate'>{folder.name}</span>
          {isSelected ? <Check className='size-[14px] shrink-0 text-[var(--text-icon)]' /> : null}
        </button>
        {children.length > 0 ? (
          <button
            type='button'
            aria-label={open ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className='shrink-0 text-[var(--text-icon)] transition-colors hover:text-[var(--text-primary)]'
          >
            <ChevronDown className={cn('size-[14px] transition-transform', open && 'rotate-180')} />
          </button>
        ) : null}
      </div>
      {open && children.length > 0 ? (
        <div className='ml-3 flex flex-col gap-1'>
          {children.map((child) => (
            <FolderRow
              key={child.id}
              folder={child}
              foldersByParent={foldersByParent}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
