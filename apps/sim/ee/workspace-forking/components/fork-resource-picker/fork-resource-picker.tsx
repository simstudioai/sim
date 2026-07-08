'use client'

import { useId, useMemo, useState } from 'react'
import { Checkbox, ChevronDown, cn } from '@sim/emcn'
import {
  ForkFileTree,
  type ForkFlatFile,
  groupForkFilesIntoFolders,
} from '@/ee/workspace-forking/components/fork-file-tree/fork-file-tree'

/** A flat copyable resource (table / KB / custom tool / skill / MCP server) in the picker. */
export interface ForkResourcePickerItem {
  id: string
  label: string
}

interface ResourceKindRowProps {
  label: string
  items: ForkResourcePickerItem[]
  selected: Set<string>
  /** Toggle the given ids on/off. Used by the select-all header checkbox. */
  onToggleMany: (ids: string[], checked: boolean) => void
  onToggleItem: (id: string, checked: boolean) => void
  disabled?: boolean
}

/**
 * One expandable resource kind in the fork / sync copy picker: a tri-state "select all" header
 * (count of selected / total) plus, when expanded, a scrollable list of individual resources so
 * the user can copy a specific subset. Shared by the fork modal's "Copy resources" and the sync
 * modal's "Copy resources" so the two surfaces stay identical. Files nest in a folder tree
 * instead - use {@link FileKindRow}.
 */
export function ResourceKindRow({
  label,
  items,
  selected,
  onToggleMany,
  onToggleItem,
  disabled = false,
}: ResourceKindRowProps) {
  const [expanded, setExpanded] = useState(false)
  const fieldId = useId()

  const total = items.length
  const selectedCount = items.reduce((count, item) => count + (selected.has(item.id) ? 1 : 0), 0)
  const headerState = selectedCount === 0 ? false : selectedCount === total ? true : 'indeterminate'

  return (
    <div className='flex flex-col gap-1'>
      <div className='flex items-center gap-2 text-[var(--text-body)] text-sm'>
        <Checkbox
          size='sm'
          aria-label={`Copy all ${label}`}
          checked={headerState}
          onCheckedChange={() =>
            onToggleMany(
              items.map((item) => item.id),
              headerState !== true
            )
          }
          disabled={disabled}
        />
        <button
          type='button'
          className='flex min-w-0 flex-1 items-center gap-1 text-left hover:text-[var(--text-primary)]'
          onClick={() => setExpanded((value) => !value)}
        >
          <span className='min-w-0 flex-1 truncate'>
            {label} ({selectedCount > 0 ? `${selectedCount}/${total}` : total})
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
        <div className='ml-6 flex max-h-44 flex-col gap-0.5 overflow-y-auto'>
          {items.map((item) => {
            const isChecked = selected.has(item.id)
            const itemId = `${fieldId}-${item.id}`
            return (
              <label
                key={item.id}
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
                  checked={isChecked}
                  onCheckedChange={(checked) => onToggleItem(item.id, checked === true)}
                  disabled={disabled}
                />
                <span className='truncate'>{item.label}</span>
              </label>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

interface FileKindRowProps {
  label: string
  files: ForkFlatFile[]
  selected: Set<string>
  onToggleAll: (selectAll: boolean) => void
  onToggleItem: (id: string, checked: boolean) => void
  onToggleMany: (ids: string[], checked: boolean) => void
  disabled?: boolean
}

/**
 * The Files kind: a tri-state "select all" header (count selected / total) that expands to a
 * folder ▸ file tree, so the user can copy a whole folder or a specific file. Files are the only
 * copyable kind that nests; every other kind uses the flat {@link ResourceKindRow}. Shared by the
 * fork and sync copy pickers so both group files identically.
 */
export function FileKindRow({
  label,
  files,
  selected,
  onToggleAll,
  onToggleItem,
  onToggleMany,
  disabled = false,
}: FileKindRowProps) {
  const [expanded, setExpanded] = useState(false)

  const total = files.length
  const selectedCount = files.filter((file) => selected.has(file.id)).length
  const headerState = selectedCount === 0 ? false : selectedCount === total ? true : 'indeterminate'

  const { folders, rootFiles } = useMemo(() => groupForkFilesIntoFolders(files), [files])

  return (
    <div className='flex flex-col gap-1'>
      <div className='flex items-center gap-2 text-[var(--text-body)] text-sm'>
        <Checkbox
          size='sm'
          aria-label={`Copy all ${label}`}
          checked={headerState}
          onCheckedChange={() => onToggleAll(headerState !== true)}
          disabled={disabled}
        />
        <button
          type='button'
          className='flex min-w-0 flex-1 items-center gap-1 text-left hover:text-[var(--text-primary)]'
          onClick={() => setExpanded((value) => !value)}
        >
          <span className='min-w-0 flex-1 truncate'>
            {label} ({selectedCount > 0 ? `${selectedCount}/${total}` : total})
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
        <div className='ml-6'>
          <ForkFileTree
            folders={folders}
            rootFiles={rootFiles}
            isSelected={(id) => selected.has(id)}
            onToggleFile={onToggleItem}
            onToggleMany={onToggleMany}
            disabled={disabled}
          />
        </div>
      ) : null}
    </div>
  )
}
