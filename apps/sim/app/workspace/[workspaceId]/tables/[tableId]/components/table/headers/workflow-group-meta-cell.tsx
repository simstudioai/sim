'use client'

import type React from 'react'
import { useCallback, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { ArrowLeft, ArrowRight, EyeOff, Pencil, PlayOutline, Trash } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { SELECTION_TINT_BG } from '../constants'
import type { DisplayColumn } from '../types'

const WORKFLOW_META_BG_ALPHA = 12 // 0–255

interface ColumnOptionsMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  position: { x: number; y: number }
  column: DisplayColumn
  /** Override for the destructive item's label. Defaults to "Delete column"
   *  (or "Delete workflow" when `onDeleteGroup` is set). Use "Hide column"
   *  when the destructive action is non-lossy (workflow-output column where
   *  removing it leaves the group with siblings). */
  deleteLabel?: string
  onOpenConfig: (columnName: string) => void
  onInsertLeft: (columnName: string) => void
  onInsertRight: (columnName: string) => void
  onDeleteColumn: (columnName: string) => void
  /** When provided (i.e. menu opened from a workflow-group meta header), the
   *  "Delete" item deletes the entire workflow group rather than the single
   *  column. Wins over `onDeleteColumn` for the destructive action. */
  onDeleteGroup?: () => void
  /** When provided, the menu is being opened from a workflow-group header and
   *  exposes group-level run actions above the column actions. */
  onRunGroupAll?: () => void
  onRunGroupIncomplete?: () => void
}

/**
 * Shared column-options dropdown rendered next to the column header chevron
 * AND on right-click of the workflow group meta cell. Anchors to a fixed
 * position passed in (so callers can place it under the chevron, or at the
 * cursor for context-menu use). Rename / change type / unique live in the
 * column sidebar (opened by Edit column).
 */
export function ColumnOptionsMenu({
  open,
  onOpenChange,
  position,
  column,
  deleteLabel,
  onOpenConfig,
  onInsertLeft,
  onInsertRight,
  onDeleteColumn,
  onDeleteGroup,
  onRunGroupAll,
  onRunGroupIncomplete,
}: ColumnOptionsMenuProps) {
  const showRunActions = Boolean(onRunGroupAll && onRunGroupIncomplete)
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <div
          style={{
            position: 'fixed',
            left: `${position.x}px`,
            top: `${position.y}px`,
            width: '1px',
            height: '1px',
            pointerEvents: 'none',
          }}
          tabIndex={-1}
          aria-hidden='true'
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        side='bottom'
        sideOffset={4}
        className='max-h-none'
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {showRunActions && (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <PlayOutline />
                Run
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => onRunGroupAll?.()}>Run all rows</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onRunGroupIncomplete?.()}>
                  Run empty rows
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={() => onOpenConfig(column.name)}>
          <Pencil />
          Edit column
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onInsertLeft(column.name)}>
          <ArrowLeft />
          Insert column left
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onInsertRight(column.name)}>
          <ArrowRight />
          Insert column right
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => (onDeleteGroup ? onDeleteGroup() : onDeleteColumn(column.name))}
        >
          {deleteLabel === 'Hide column' ? <EyeOff /> : <Trash />}
          {deleteLabel ?? (onDeleteGroup ? 'Delete workflow' : 'Delete column')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface WorkflowGroupMetaCellProps {
  workflowId: string
  groupId: string
  size: number
  startColIndex: number
  columnName: string
  /** Underlying logical column — needed for the right-click options menu. */
  column?: DisplayColumn
  workflows?: WorkflowMetadata[]
  isGroupSelected: boolean
  onSelectGroup: (startColIndex: number, size: number) => void
  onOpenConfig: (columnName: string) => void
  onRunGroup?: (groupId: string, workflowId: string, mode?: 'all' | 'incomplete') => void
  onInsertLeft?: (columnName: string) => void
  onInsertRight?: (columnName: string) => void
  onDeleteColumn?: (columnName: string) => void
  /** Right-click delete on the group header drops the entire workflow group. */
  onDeleteGroup?: (groupId: string) => void
}

/**
 * Spans a fanned-out workflow column group in the table's meta header row.
 * Renders the workflow's color chip + name so the grouping across N sibling
 * columns reads as one unit.
 */
export function WorkflowGroupMetaCell({
  workflowId,
  groupId,
  size,
  startColIndex,
  columnName,
  column,
  workflows,
  isGroupSelected,
  onSelectGroup,
  onOpenConfig,
  onRunGroup,
  onInsertLeft,
  onInsertRight,
  onDeleteColumn,
  onDeleteGroup,
}: WorkflowGroupMetaCellProps) {
  const wf = workflows?.find((w) => w.id === workflowId)
  const color = wf?.color ?? 'var(--text-muted)'
  const name = wf?.name ?? 'Workflow'

  const [optionsMenuOpen, setOptionsMenuOpen] = useState(false)
  const [optionsMenuPosition, setOptionsMenuPosition] = useState({ x: 0, y: 0 })
  const [runMenuOpen, setRunMenuOpen] = useState(false)

  const handleRunAll = useCallback(() => {
    if (groupId && workflowId) onRunGroup?.(groupId, workflowId, 'all')
  }, [groupId, workflowId, onRunGroup])

  const handleRunIncomplete = useCallback(() => {
    if (groupId && workflowId) onRunGroup?.(groupId, workflowId, 'incomplete')
  }, [groupId, workflowId, onRunGroup])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!column) return
      e.preventDefault()
      e.stopPropagation()
      setOptionsMenuPosition({ x: e.clientX, y: e.clientY })
      setOptionsMenuOpen(true)
    },
    [column]
  )

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLTableCellElement>) => {
      // Ignore clicks that landed on an interactive child (badge, play button,
      // dropdown items rendered via portal). Only the bare meta-cell area
      // should select the group + open the config sidebar.
      const target = e.target as HTMLElement
      if (target.closest('button, [role="menuitem"], [role="menu"]')) return
      onSelectGroup(startColIndex, size)
      if (columnName) onOpenConfig(columnName)
    },
    [columnName, onOpenConfig, onSelectGroup, size, startColIndex]
  )

  return (
    <th
      colSpan={size}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      className='group relative cursor-pointer border-[var(--border)] border-r border-b border-l bg-[var(--bg)] px-2 py-[5px] text-left align-middle'
    >
      <div
        className='pointer-events-none absolute inset-0'
        style={{ background: `${color}${WORKFLOW_META_BG_ALPHA.toString(16).padStart(2, '0')}` }}
      />
      {/* Selection tint as a separate overlay so the th's opaque `--bg` stays
          intact — see column-header-menu for the same fix. */}
      {isGroupSelected && (
        <div
          className={cn('pointer-events-none absolute inset-0', SELECTION_TINT_BG)}
          aria-hidden='true'
        />
      )}
      <div
        className='pointer-events-none absolute inset-x-0 top-0 h-[2px]'
        style={{ background: color }}
      />
      <div className='flex h-[18px] min-w-0 items-center gap-1.5'>
        <span
          className='h-[10px] w-[10px] shrink-0 rounded-sm border-[2px]'
          style={{
            backgroundColor: color,
            borderColor: `${color}60`,
            backgroundClip: 'padding-box',
          }}
        />
        <span className='min-w-0 truncate font-medium text-[11px] text-[var(--text-secondary)]'>
          {name}
        </span>
        {onRunGroup && (
          <DropdownMenu open={runMenuOpen} onOpenChange={setRunMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type='button'
                className='flex h-[16px] w-[16px] shrink-0 cursor-pointer items-center justify-center rounded-sm text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]'
                onClick={(e) => e.stopPropagation()}
                aria-label='Run group'
                title='Run group'
              >
                <PlayOutline className='h-[10px] w-[10px]' />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align='start'
              side='bottom'
              sideOffset={4}
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <DropdownMenuItem onSelect={handleRunAll}>Run all rows</DropdownMenuItem>
              <DropdownMenuItem onSelect={handleRunIncomplete}>Run empty rows</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {column && onInsertLeft && onInsertRight && onDeleteColumn && (
        <ColumnOptionsMenu
          open={optionsMenuOpen}
          onOpenChange={setOptionsMenuOpen}
          position={optionsMenuPosition}
          column={column}
          onOpenConfig={onOpenConfig}
          onInsertLeft={onInsertLeft}
          onInsertRight={onInsertRight}
          onDeleteColumn={onDeleteColumn}
          onDeleteGroup={onDeleteGroup ? () => onDeleteGroup(groupId) : undefined}
          onRunGroupAll={onRunGroup ? handleRunAll : undefined}
          onRunGroupIncomplete={onRunGroup ? handleRunIncomplete : undefined}
        />
      )}
    </th>
  )
}
