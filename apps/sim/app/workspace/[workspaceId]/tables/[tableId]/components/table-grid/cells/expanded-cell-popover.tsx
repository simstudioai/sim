'use client'

import type React from 'react'
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@sim/emcn'
import type { TableRow as TableRowType } from '@/lib/table'
import { useTimezone } from '@/hooks/queries/general-settings'
import type { EditingCell, SaveReason } from '../../../types'
import {
  cleanCellValue,
  displayToStorage,
  formatValueForInput,
  storageToDisplay,
} from '../../../utils'
import { SelectValueEditor } from '../../select-field'
import type { DisplayColumn } from '../types'

interface ExpandedCellPopoverProps {
  expandedCell: EditingCell | null
  onClose: () => void
  rows: TableRowType[]
  columns: DisplayColumn[]
  onSave: (rowId: string, columnName: string, value: unknown, reason: SaveReason) => void
  canEdit: boolean
  scrollContainer: HTMLElement | null
}

const EXPANDED_CELL_MIN_WIDTH = 420
const EXPANDED_CELL_HEIGHT = 280

/**
 * Anchored cell editor. Floats over the double-clicked cell, minimum width
 * {@link EXPANDED_CELL_MIN_WIDTH}, fixed height, internally scrollable.
 *
 * Workflow and boolean cells are read-only here — workflow cells are driven
 * by the scheduler, booleans toggle inline.
 */
export function ExpandedCellPopover({
  expandedCell,
  onClose,
  rows,
  columns,
  onSave,
  canEdit,
  scrollContainer,
}: ExpandedCellPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null)

  const target = useMemo(() => {
    if (!expandedCell) return null
    const row = rows.find((r) => r.id === expandedCell.rowId)
    // Match the specific visual column the user double-clicked on. Fanned-out
    // workflow columns share `name` across siblings, so prefer `key` when set.
    const matchByKey = expandedCell.columnKey
      ? (c: DisplayColumn) => c.key === expandedCell.columnKey
      : (c: DisplayColumn) => c.key === expandedCell.columnName
    const column = columns.find(matchByKey)
    if (!row || !column) return null
    const colIndex = columns.findIndex(matchByKey)
    return { row, column, colIndex, value: row.data[column.key] }
  }, [expandedCell, rows, columns])

  const isBooleanCell = target?.column.type === 'boolean'
  const isSelectCell = target?.column.type === 'select' || target?.column.type === 'multiselect'
  // Workflow-output cells are editable in the expanded view too — the user
  // can override the workflow's value. Booleans toggle inline; the expanded
  // popover only handles text-shaped inputs.
  const isEditable = Boolean(target) && canEdit && !isBooleanCell

  const displayText = useMemo(() => {
    if (!target) return ''
    const { value } = target
    if (value == null) return ''
    if (typeof value === 'string') return value
    return JSON.stringify(value, null, 2)
  }, [target])

  useLayoutEffect(() => {
    if (!expandedCell || !target) {
      setRect(null)
      return
    }
    const selector = `[data-table-scroll] [data-row-id="${target.row.id}"][data-col="${target.colIndex}"]`
    const el = document.querySelector<HTMLElement>(selector)
    if (!el) {
      setRect(null)
      return
    }
    const r = el.getBoundingClientRect()
    setRect({ top: r.top, left: r.left, width: r.width })
    // Focus textarea on open so typing works immediately.
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [expandedCell, target])

  const onCloseEvent = useEffectEvent(onClose)

  useEffect(() => {
    if (!expandedCell) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseEvent()
      }
    }
    const handleMouseDown = (e: MouseEvent) => {
      if (!rootRef.current) return
      if (rootRef.current.contains(e.target as Node)) return
      onCloseEvent()
    }
    window.addEventListener('keydown', handleKey)
    window.addEventListener('mousedown', handleMouseDown)
    return () => {
      window.removeEventListener('keydown', handleKey)
      window.removeEventListener('mousedown', handleMouseDown)
    }
  }, [expandedCell])

  // Close on table scroll — re-anchoring mid-scroll is more jarring than dismissing.
  useEffect(() => {
    if (!expandedCell || !scrollContainer) return
    const handler = () => onCloseEvent()
    scrollContainer.addEventListener('scroll', handler, { passive: true })
    return () => scrollContainer.removeEventListener('scroll', handler)
  }, [expandedCell, scrollContainer])

  if (!expandedCell || !target || !rect) return null

  const width = Math.max(rect.width, EXPANDED_CELL_MIN_WIDTH)
  // Clamp to viewport. Prefer anchoring at the cell's left edge; if the popover
  // would overflow right, align its right edge with the cell's right edge
  // (mirroring Radix/menu flip behavior). Same idea for bottom-of-viewport.
  const VIEWPORT_PAD = 8
  const cellRight = rect.left + rect.width
  const overflowsRight = rect.left + width > window.innerWidth - VIEWPORT_PAD
  const left = overflowsRight
    ? Math.max(VIEWPORT_PAD, cellRight - width)
    : Math.max(VIEWPORT_PAD, rect.left)
  const overflowsBottom = rect.top + EXPANDED_CELL_HEIGHT > window.innerHeight - VIEWPORT_PAD
  const top = overflowsBottom
    ? Math.max(VIEWPORT_PAD, window.innerHeight - EXPANDED_CELL_HEIGHT - VIEWPORT_PAD)
    : rect.top

  return (
    <div
      ref={rootRef}
      role='dialog'
      aria-label={`Expanded view of ${target.column.name}`}
      className='fixed z-50 flex flex-col overflow-hidden rounded-md border border-[var(--border-1)] bg-[var(--bg)] shadow-md'
      style={{ top, left, width, height: EXPANDED_CELL_HEIGHT }}
    >
      {isEditable && isSelectCell ? (
        <ExpandedSelectEditor
          key={`${expandedCell.rowId}:${expandedCell.columnKey ?? expandedCell.columnName}`}
          initialValue={target.value}
          column={target.column}
          rowId={target.row.id}
          onSave={onSave}
          onClose={onClose}
        />
      ) : isEditable ? (
        <ExpandedCellEditor
          key={`${expandedCell.rowId}:${expandedCell.columnKey ?? expandedCell.columnName}`}
          initialValue={
            target.column.type === 'date'
              ? storageToDisplay(formatValueForInput(target.value, 'date'), { seconds: true })
              : formatValueForInput(target.value, target.column.type)
          }
          column={target.column}
          rowId={target.row.id}
          onSave={onSave}
          onClose={onClose}
          textareaRef={textareaRef}
        />
      ) : (
        <>
          <div className='min-h-0 flex-1 overflow-auto px-2.5 py-2'>
            {displayText ? (
              <pre className='whitespace-pre-wrap break-words font-sans text-[var(--text-primary)] text-small'>
                {displayText}
              </pre>
            ) : (
              <span className='text-[var(--text-tertiary)] text-small'>(empty)</span>
            )}
          </div>
          <div className='flex items-center justify-end border-[var(--border)] border-t bg-[var(--surface-2)] px-2 py-1.5'>
            <Button variant='ghost' size='sm' onClick={onClose}>
              Close
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

interface ExpandedCellEditorProps {
  initialValue: string
  column: DisplayColumn
  rowId: string
  onSave: ExpandedCellPopoverProps['onSave']
  onClose: () => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}

/**
 * Editable body of the popover. Keyed on the edited cell so the draft
 * survives unrelated row refetches (SSE cache patches, polling) while the
 * popover is open, and resets only when the target cell changes.
 */
function ExpandedCellEditor({
  initialValue,
  column,
  rowId,
  onSave,
  onClose,
  textareaRef,
}: ExpandedCellEditorProps) {
  const [draftValue, setDraftValue] = useState(initialValue)
  const [parseError, setParseError] = useState<string | null>(null)
  const timeZone = useTimezone()

  const handleSave = () => {
    // Untouched draft → close without writing. For dates this also avoids
    // re-stamping the stored offset with this viewer's zone.
    if (draftValue === initialValue) {
      onClose()
      return
    }
    // Only date columns go through `displayToStorage` — it now parses many
    // date shapes, so a number draft like "2024" must not reach it.
    const raw =
      column.type === 'date' ? (displayToStorage(draftValue, timeZone) ?? draftValue) : draftValue
    let cleaned: unknown
    try {
      cleaned = cleanCellValue(raw, column, timeZone)
    } catch {
      setParseError('Invalid JSON')
      return
    }
    /** `cleanCellValue` nulls unparseable dates/numbers instead of throwing — reject rather than silently clear. */
    if (
      cleaned === null &&
      draftValue.trim() !== '' &&
      (column.type === 'date' || column.type === 'number')
    ) {
      setParseError(column.type === 'date' ? 'Invalid date' : 'Invalid number')
      return
    }
    onSave(rowId, column.key, cleaned, 'blur')
    onClose()
  }

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSave()
    }
  }

  return (
    <>
      <textarea
        ref={textareaRef}
        value={draftValue}
        onChange={(e) => {
          setDraftValue(e.target.value)
          setParseError(null)
        }}
        onKeyDown={handleTextareaKeyDown}
        className='min-h-0 flex-1 resize-none bg-transparent px-2.5 py-2 font-sans text-[var(--text-primary)] text-small outline-none placeholder:text-[var(--text-muted)]'
        spellCheck={false}
        autoCorrect='off'
      />
      <div className='flex items-center justify-between border-[var(--border)] border-t bg-[var(--surface-2)] px-2 py-1.5'>
        {parseError ? (
          <span className='text-[var(--text-error)] text-caption'>{parseError}</span>
        ) : (
          <span className='text-[var(--text-tertiary)] text-caption'>
            <kbd className='font-mono'>↵</kbd> save · <kbd className='font-mono'>esc</kbd> cancel
          </span>
        )}
        <div className='flex items-center gap-1.5'>
          <Button variant='ghost' size='sm' onClick={onClose}>
            Cancel
          </Button>
          <Button size='sm' variant='primary' onClick={handleSave}>
            Save
          </Button>
        </div>
      </div>
    </>
  )
}

interface ExpandedSelectEditorProps {
  initialValue: unknown
  column: DisplayColumn
  rowId: string
  onSave: ExpandedCellPopoverProps['onSave']
  onClose: () => void
}

/** Select/multiselect body of the expanded popover. */
function ExpandedSelectEditor({
  initialValue,
  column,
  rowId,
  onSave,
  onClose,
}: ExpandedSelectEditorProps) {
  const [draft, setDraft] = useState<string | string[] | null>(
    column.type === 'multiselect'
      ? Array.isArray(initialValue)
        ? (initialValue as string[])
        : []
      : typeof initialValue === 'string' && initialValue !== ''
        ? initialValue
        : null
  )

  const handleSave = () => {
    onSave(rowId, column.key, draft, 'blur')
    onClose()
  }

  return (
    <>
      <div className='min-h-0 flex-1 overflow-auto px-2.5 py-2.5'>
        <SelectValueEditor column={column} value={draft} onChange={setDraft} fullWidth />
      </div>
      <div className='flex items-center justify-end border-[var(--border)] border-t bg-[var(--surface-2)] px-2 py-1.5'>
        <div className='flex items-center gap-1.5'>
          <Button variant='ghost' size='sm' onClick={onClose}>
            Cancel
          </Button>
          <Button size='sm' variant='primary' onClick={handleSave}>
            Save
          </Button>
        </div>
      </div>
    </>
  )
}
