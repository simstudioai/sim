'use client'

import { memo, useMemo, useState } from 'react'
import {
  Chip,
  cn,
  POPOVER_ANIMATION_CLASSES,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverSection,
  PopoverTrigger,
} from '@sim/emcn'
import { Columns3, Eye, EyeOff } from '@sim/emcn/icons'
import type { ColumnDefinition, WorkflowGroup } from '@/lib/table'
import { getColumnId } from '@/lib/table/column-keys'

interface ColumnsMenuProps {
  columns: ColumnDefinition[]
  workflowGroups: WorkflowGroup[]
  /** **Column ids** currently hidden from the grid. */
  hiddenColumns: string[]
  onChange: (hiddenColumns: string[]) => void
}

/**
 * Show/hide picker for grid columns. Workflow output columns nest under their
 * group with a parent toggle that flips all of its children at once — the
 * group's spanning header is derived from whichever children stay visible, so
 * hiding them all removes the header too.
 */
export const ColumnsMenu = memo(function ColumnsMenu({
  columns,
  workflowGroups,
  hiddenColumns,
  onChange,
}: ColumnsMenuProps) {
  const [open, setOpen] = useState(false)
  const hiddenSet = new Set(hiddenColumns)

  const { plain, groups } = useMemo(() => {
    const plainColumns: ColumnDefinition[] = []
    const byGroup = new Map<string, ColumnDefinition[]>()
    for (const col of columns) {
      if (col.workflowGroupId) {
        const existing = byGroup.get(col.workflowGroupId)
        if (existing) existing.push(col)
        else byGroup.set(col.workflowGroupId, [col])
      } else {
        plainColumns.push(col)
      }
    }
    const groupById = new Map(workflowGroups.map((group) => [group.id, group]))
    return {
      plain: plainColumns,
      groups: [...byGroup.entries()].map(([groupId, children]) => ({
        groupId,
        name: groupById.get(groupId)?.name ?? 'Workflow',
        children,
      })),
    }
  }, [columns, workflowGroups])

  /**
   * Flips one or more columns. Rejects a change that would hide every column —
   * an empty grid has nothing left to act on.
   */
  const toggle = (ids: string[], nextHidden: boolean) => {
    const next = new Set(hiddenColumns)
    for (const id of ids) {
      if (nextHidden) next.add(id)
      else next.delete(id)
    }
    if (next.size >= columns.length) return
    onChange([...next])
  }

  const hiddenCount = hiddenColumns.length

  return (
    <Popover size='md' open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Chip active={hiddenCount > 0} leftIcon={Columns3}>
          {hiddenCount > 0 ? `Columns (${hiddenCount} hidden)` : 'Columns'}
        </Chip>
      </PopoverTrigger>
      <PopoverContent
        side='bottom'
        align='start'
        sideOffset={6}
        minWidth={240}
        maxWidth={320}
        maxHeight={420}
        border
        className={cn(
          POPOVER_ANIMATION_CLASSES,
          'bg-[var(--bg)] p-1.5 text-[var(--text-body)] shadow-sm'
        )}
      >
        <PopoverSection className='px-1.5 py-0.5 text-[var(--text-muted)] text-xs'>
          Columns
        </PopoverSection>
        <div className='flex flex-col gap-0.5'>
          {plain.map((col) => {
            const id = getColumnId(col)
            return (
              <ColumnToggleRow
                key={id}
                label={col.name}
                visible={!hiddenSet.has(id)}
                onToggle={(nextVisible) => toggle([id], !nextVisible)}
              />
            )
          })}
          {groups.map((group) => {
            const childIds = group.children.map(getColumnId)
            const visibleCount = childIds.filter((id) => !hiddenSet.has(id)).length
            return (
              <div key={group.groupId} className='flex flex-col gap-0.5'>
                {/* `visible` is all-children-visible, so a partial group reads as
                    not-yet-visible and one click reveals the rest rather than
                    hiding what is still showing. */}
                <ColumnToggleRow
                  label={group.name}
                  visible={visibleCount === childIds.length}
                  partial={visibleCount > 0 && visibleCount < childIds.length}
                  onToggle={(nextVisible) => toggle(childIds, !nextVisible)}
                />
                {group.children.map((col) => {
                  const id = getColumnId(col)
                  return (
                    <ColumnToggleRow
                      key={id}
                      label={col.name}
                      visible={!hiddenSet.has(id)}
                      indented
                      onToggle={(nextVisible) => toggle([id], !nextVisible)}
                    />
                  )
                })}
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
})

interface ColumnToggleRowProps {
  label: string
  visible: boolean
  /** Group parent whose children are only partly visible. */
  partial?: boolean
  indented?: boolean
  onToggle: (nextVisible: boolean) => void
}

function ColumnToggleRow({ label, visible, partial, indented, onToggle }: ColumnToggleRowProps) {
  // A partial group still has something on screen, so it keeps the "shown" icon
  // at reduced strength rather than flipping to the hidden one.
  const showing = visible || partial
  const Icon = showing ? Eye : EyeOff
  return (
    <PopoverItem
      onClick={() => onToggle(!visible)}
      className={cn('h-7 items-center gap-1.5 px-1.5 py-0 text-xs', indented && 'pl-5')}
    >
      <span className='flex size-[14px] shrink-0 items-center justify-center'>
        <Icon
          className={cn(
            'size-3',
            showing ? 'text-[var(--text-icon)]' : 'text-[var(--text-muted)]',
            partial && 'opacity-60'
          )}
        />
      </span>
      <span
        className={cn('min-w-0 flex-1 truncate text-left', !showing && 'text-[var(--text-muted)]')}
      >
        {label}
      </span>
    </PopoverItem>
  )
}
