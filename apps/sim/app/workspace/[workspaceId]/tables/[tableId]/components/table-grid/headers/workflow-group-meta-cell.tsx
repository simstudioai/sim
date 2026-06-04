'use client'

import type React from 'react'
import { useRef, useState } from 'react'
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
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Pencil,
  Pin,
  PinOff,
  PlayOutline,
  Trash,
} from '@/components/emcn/icons'
import type { RunLimit, RunMode } from '@/lib/api/contracts/tables'
import { cn } from '@/lib/core/utils/cn'
import type { WorkflowGroupType } from '@/lib/table'
import { getEnrichment } from '@/enrichments/registry'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { SELECTION_TINT_BG } from '../constants'
import type { DisplayColumn } from '../types'

const WORKFLOW_META_BG_ALPHA = 12 // 0–255

/** Fixed row-cap presets for the "Run N empty rows" shortcuts. Shared by the
 *  group-header options menu and the inline quick-run dropdown so the two
 *  surfaces stay in sync. */
const LIMITED_RUN_PRESETS = [10, 1000] as const

interface ColumnOptionsMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  position: { x: number; y: number }
  column: DisplayColumn
  /** Override for the destructive item's label. Defaults to "Delete column"
   *  for both plain columns and workflow groups. Use "Hide column" when the
   *  destructive action is non-lossy (workflow-output column where removing
   *  it leaves the group with siblings). */
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
  onRunColumnAll?: () => void
  onRunColumnIncomplete?: () => void
  /** Runs only the first `max` empty/unrun rows. Surfaces fixed "Run N rows"
   *  shortcuts so users can sample a large table without firing every row. */
  onRunColumnLimited?: (max: number) => void
  /** When set, surfaces a "Run N selected rows" item above Run all. */
  onRunColumnSelected?: () => void
  selectedRowCount?: number
  /** When set, the menu surfaces a "View workflow" item that opens a popup
   *  preview of the configured workflow. */
  onViewWorkflow?: () => void
  /** Whether this column is currently pinned to the left. */
  isPinned?: boolean
  /** Toggle the pinned state of this column. */
  onPinToggle?: (columnName: string) => void
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
  onRunColumnAll,
  onRunColumnIncomplete,
  onRunColumnLimited,
  onRunColumnSelected,
  selectedRowCount = 0,
  onViewWorkflow,
  isPinned,
  onPinToggle,
}: ColumnOptionsMenuProps) {
  const showRunActions = Boolean(onRunColumnAll && onRunColumnIncomplete)
  const showRunSelected = Boolean(onRunColumnSelected) && selectedRowCount > 0
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
                {showRunSelected && (
                  <DropdownMenuItem onSelect={() => onRunColumnSelected?.()}>
                    {`Run ${selectedRowCount} selected ${selectedRowCount === 1 ? 'row' : 'rows'}`}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => onRunColumnAll?.()}>
                  Run all rows
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onRunColumnIncomplete?.()}>
                  Run empty rows
                </DropdownMenuItem>
                {onRunColumnLimited &&
                  LIMITED_RUN_PRESETS.map((max) => (
                    <DropdownMenuItem key={max} onSelect={() => onRunColumnLimited(max)}>
                      {`Run ${max.toLocaleString()} empty rows`}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
          </>
        )}
        {onViewWorkflow && (
          <DropdownMenuItem onSelect={() => onViewWorkflow()}>
            <Eye />
            View workflow
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => onOpenConfig(column.name)}>
          <Pencil />
          Edit column
        </DropdownMenuItem>
        {onPinToggle && (
          <DropdownMenuItem onSelect={() => onPinToggle(column.name)}>
            {isPinned ? <PinOff /> : <Pin />}
            {isPinned ? 'Unpin column' : 'Pin column'}
          </DropdownMenuItem>
        )}
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
          {deleteLabel ?? 'Delete column'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface WorkflowGroupMetaCellProps {
  workflowId: string
  groupId: string
  /** When `'enrichment'`, the cell shows the enrichment's name + icon instead
   *  of a backing workflow's color chip + name. */
  groupType?: WorkflowGroupType
  /** Registry id for enrichment groups (resolves name/icon fallback). */
  enrichmentId?: string
  /** Persisted group name (the enrichment name at creation). */
  groupName?: string
  size: number
  startColIndex: number
  columnName: string
  /** Underlying logical column — needed for the right-click options menu. */
  column?: DisplayColumn
  workflows?: WorkflowMetadata[]
  isGroupSelected: boolean
  onSelectGroup: (startColIndex: number, size: number) => void
  onOpenConfig: (columnName: string) => void
  onRunColumn?: (groupId: string, mode?: RunMode, rowIds?: string[], limit?: RunLimit) => void
  onInsertLeft?: (columnName: string) => void
  onInsertRight?: (columnName: string) => void
  onDeleteColumn?: (columnName: string) => void
  /** Right-click delete on the group header drops the entire workflow group. */
  onDeleteGroup?: (groupId: string) => void
  /** Row ids in the user's current multi-row selection; when non-empty the
   *  run menu adds a "Run N selected rows" option. */
  selectedRowIds?: string[] | null
  /** Opens a popup preview of the underlying workflow. */
  onViewWorkflow?: (workflowId: string) => void
  /** When set, the meta cell becomes draggable and forwards events through
   *  the same column-reorder pipeline used by individual workflow column
   *  headers. The whole group moves together because downstream code groups
   *  fan-out siblings by `workflowGroupId`. */
  onDragStart?: (columnName: string) => void
  onDragOver?: (columnName: string, side: 'left' | 'right') => void
  onDragEnd?: () => void
  onDragLeave?: () => void
  readOnly?: boolean
  /** Left offset in pixels when pinned (drives `position: sticky`). */
  stickyLeft?: number
  /** Whether this is the rightmost pinned column group (renders a separator shadow). */
  isLastPinned?: boolean
  /** Whether this column group is currently pinned to the left. */
  isPinned?: boolean
  /** Toggle the pinned state for this column group. */
  onPinToggle?: (columnName: string) => void
}

/**
 * Spans a fanned-out workflow column group in the table's meta header row.
 * Renders the workflow's color chip + name so the grouping across N sibling
 * columns reads as one unit.
 */
export function WorkflowGroupMetaCell({
  workflowId,
  groupId,
  groupType,
  enrichmentId,
  groupName,
  size,
  startColIndex,
  columnName,
  column,
  workflows,
  isGroupSelected,
  onSelectGroup,
  onOpenConfig,
  onRunColumn,
  onInsertLeft,
  onInsertRight,
  onDeleteColumn,
  onDeleteGroup,
  selectedRowIds,
  onViewWorkflow,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDragLeave,
  readOnly,
  stickyLeft,
  isLastPinned,
  isPinned,
  onPinToggle,
}: WorkflowGroupMetaCellProps) {
  const isEnrichment = groupType === 'enrichment'
  const enrichment = isEnrichment ? getEnrichment(enrichmentId) : undefined
  const EnrichmentIcon = enrichment?.icon
  const wf = workflows?.find((w) => w.id === workflowId)
  const color = wf?.color ?? 'var(--text-muted)'
  const name = isEnrichment
    ? (groupName ?? enrichment?.name ?? 'Enrichment')
    : (wf?.name ?? 'Workflow')

  const [optionsMenuOpen, setOptionsMenuOpen] = useState(false)
  const [optionsMenuPosition, setOptionsMenuPosition] = useState({ x: 0, y: 0 })
  const [runMenuOpen, setRunMenuOpen] = useState(false)
  const didDragRef = useRef(false)

  const selectedCount = selectedRowIds?.length ?? 0

  function handleRunAll() {
    if (groupId) onRunColumn?.(groupId, 'all')
  }

  function handleRunIncomplete() {
    if (groupId) onRunColumn?.(groupId, 'incomplete')
  }

  function handleRunSelected() {
    if (groupId && selectedRowIds && selectedRowIds.length > 0) {
      onRunColumn?.(groupId, 'all', selectedRowIds)
    }
  }

  function handleRunLimited(max: number) {
    if (groupId) onRunColumn?.(groupId, 'incomplete', undefined, { type: 'rows', max })
  }

  function handleContextMenu(e: React.MouseEvent) {
    if (!column) return
    e.preventDefault()
    e.stopPropagation()
    setOptionsMenuPosition({ x: e.clientX, y: e.clientY })
    setOptionsMenuOpen(true)
  }

  function selectGroupAndOpenConfig(e: React.MouseEvent<HTMLTableCellElement>) {
    // Ignore clicks that landed on an interactive child (badge, play button,
    // dropdown items rendered via portal). Only the bare meta-cell area
    // should select the group + open the config sidebar.
    const target = e.target as HTMLElement
    if (target.closest('button, [role="menuitem"], [role="menu"]')) return
    // Drag-vs-click guard: when a drag just ended on this cell, swallow the
    // synthetic click so we don't accidentally pop open the sidebar.
    if (didDragRef.current) {
      didDragRef.current = false
      return
    }
    onSelectGroup(startColIndex, size)
    if (columnName) onOpenConfig(columnName)
  }

  function handleDragStart(e: React.DragEvent) {
    if (readOnly || !onDragStart || !columnName) {
      e.preventDefault()
      return
    }
    didDragRef.current = true
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', columnName)

    const ghost = document.createElement('div')
    ghost.textContent = name
    ghost.style.cssText =
      'position:absolute;top:-9999px;padding:4px 8px;background:var(--bg);border:1px solid var(--border);border-radius:4px;font-size:13px;font-weight:500;white-space:nowrap;color:var(--text-primary)'
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2)
    requestAnimationFrame(() => ghost.parentNode?.removeChild(ghost))

    onDragStart(columnName)
  }

  function handleDragOver(e: React.DragEvent) {
    if (!onDragOver || !columnName) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const midX = rect.left + rect.width / 2
    const side = e.clientX < midX ? 'left' : 'right'
    onDragOver(columnName, side)
  }

  function handleDragEnd() {
    didDragRef.current = false
    onDragEnd?.()
  }

  function handleDragLeave(e: React.DragEvent) {
    const th = e.currentTarget as HTMLElement
    const related = e.relatedTarget as Node | null
    if (related && th.contains(related)) return
    if (related && related instanceof Element && related.closest('th')) return
    onDragLeave?.()
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
  }

  const isDraggable = !readOnly && Boolean(onDragStart)

  return (
    <th
      colSpan={size}
      onClick={selectGroupAndOpenConfig}
      onContextMenu={handleContextMenu}
      draggable={isDraggable}
      onDragStart={isDraggable ? handleDragStart : undefined}
      onDragOver={isDraggable ? handleDragOver : undefined}
      onDragEnd={isDraggable ? handleDragEnd : undefined}
      onDragLeave={isDraggable ? handleDragLeave : undefined}
      onDrop={isDraggable ? handleDrop : undefined}
      className={cn(
        'group relative cursor-pointer border-[var(--border)] border-r border-b bg-[var(--bg)] px-2 py-[5px] text-left align-middle before:pointer-events-none before:absolute before:top-0 before:bottom-0 before:left-[-1px] before:w-px before:bg-[var(--border)] before:content-[""]',
        stickyLeft !== undefined && 'z-[11]',
        isLastPinned && '[box-shadow:2px_0_0_0_var(--border)]'
      )}
      style={stickyLeft !== undefined ? { position: 'sticky', left: stickyLeft } : undefined}
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
        {isEnrichment && EnrichmentIcon ? (
          <EnrichmentIcon className='size-[12px] shrink-0 text-[var(--text-icon)]' />
        ) : (
          <span
            className='size-[10px] shrink-0 rounded-sm border-[2px]'
            style={{
              backgroundColor: color,
              borderColor: `${color}60`,
              backgroundClip: 'padding-box',
            }}
          />
        )}
        <span className='min-w-0 truncate font-medium text-[11px] text-[var(--text-secondary)]'>
          {name}
        </span>
        {onRunColumn && (
          <DropdownMenu open={runMenuOpen} onOpenChange={setRunMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type='button'
                className='flex size-[16px] shrink-0 cursor-pointer items-center justify-center rounded-sm text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]'
                onClick={(e) => e.stopPropagation()}
                aria-label='Run group'
                title='Run group'
              >
                <PlayOutline className='size-[10px]' />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align='start'
              side='bottom'
              sideOffset={4}
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              {selectedCount > 0 && (
                <DropdownMenuItem onSelect={handleRunSelected}>
                  {`Run ${selectedCount} selected ${selectedCount === 1 ? 'row' : 'rows'}`}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={handleRunAll}>Run all rows</DropdownMenuItem>
              <DropdownMenuItem onSelect={handleRunIncomplete}>Run empty rows</DropdownMenuItem>
              {LIMITED_RUN_PRESETS.map((max) => (
                <DropdownMenuItem key={max} onSelect={() => handleRunLimited(max)}>
                  {`Run ${max.toLocaleString()} empty rows`}
                </DropdownMenuItem>
              ))}
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
          onRunColumnAll={onRunColumn ? handleRunAll : undefined}
          onRunColumnIncomplete={onRunColumn ? handleRunIncomplete : undefined}
          onRunColumnLimited={onRunColumn ? handleRunLimited : undefined}
          onRunColumnSelected={onRunColumn && selectedCount > 0 ? handleRunSelected : undefined}
          selectedRowCount={selectedCount}
          onViewWorkflow={onViewWorkflow ? () => onViewWorkflow(workflowId) : undefined}
          isPinned={isPinned}
          onPinToggle={onPinToggle}
        />
      )}
    </th>
  )
}
