'use client'

import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Button } from '@sim/emcn/button'
import styles from '@/app/(product)/workspace/[workspaceId]/tables/[tableId]/_components/table-grid/table-grid.module.css'
import {
  cleanCellValue,
  columnTypeOf,
  type DisplayColumn,
  displayToStorage,
  type EditingCell,
  formatValueForInput,
  type SaveReason,
  storageToDisplay,
  type TableRow,
  useTimezone,
} from '@/platform/lib/data/tables'

interface ExpandedCellProps {
  expandedCell: EditingCell | null
  onClose: () => void
  rows: TableRow[]
  columns: DisplayColumn[]
  onSave: (rowId: string, columnName: string, value: unknown, reason: SaveReason) => void
  canEdit: boolean
  /** Opens the editor read-only (text stays selectable) and disables Save, with this explanation. */
  saveBlockedReason?: string
  scrollContainer: HTMLElement | null
}

/** The view never narrows below this width, so long values have room. */
const EXPANDED_CELL_MIN_WIDTH = 420
const EXPANDED_CELL_HEIGHT = 280
const VIEWPORT_PAD = 8

/**
 * A larger editor that floats over a double-clicked text or JSON cell: at least
 * {@link EXPANDED_CELL_MIN_WIDTH} wide, a fixed height, scrolling inside. It closes on Escape, on a
 * press outside it and when the table scrolls.
 */
export function ExpandedCell({
  expandedCell,
  onClose,
  rows,
  columns,
  onSave,
  canEdit,
  saveBlockedReason,
  scrollContainer,
}: ExpandedCellProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null)

  const target = useMemo(() => {
    if (!expandedCell) return null
    const row = rows.find((r) => r.id === expandedCell.rowId)
    const matchByKey = expandedCell.columnKey
      ? (c: DisplayColumn) => c.key === expandedCell.columnKey
      : (c: DisplayColumn) => c.key === expandedCell.columnName
    const column = columns.find(matchByKey)
    if (!row || !column) return null
    const colIndex = columns.findIndex(matchByKey)
    return { row, column, colIndex, value: row.data[column.key] }
  }, [expandedCell, rows, columns])

  // Workflow-output cells edit here too, overriding the workflow's value; booleans toggle inline.
  const isTogglingCell = target ? columnTypeOf(target.column).editor === 'toggle' : false
  const isEditable = Boolean(target) && canEdit && !isTogglingCell

  const displayText = useMemo(() => {
    if (!target) return ''
    const { value } = target
    if (value == null) return ''
    // Read-only viewers get the grid's date format, not the raw stored string.
    if (target.column.type === 'date' && typeof value === 'string') {
      return storageToDisplay(value, { seconds: true })
    }
    if (target.column.type === 'currency') {
      return columnTypeOf(target.column).formatForDisplay(value, target.column)
    }
    if (typeof value === 'string') return value
    return JSON.stringify(value, null, 2)
  }, [target])

  useLayoutEffect(() => {
    if (!expandedCell || !target) {
      setRect(null)
      return
    }
    const cell = scrollContainer?.querySelector<HTMLElement>(
      `[data-row-id="${CSS.escape(target.row.id)}"][data-col="${target.colIndex}"]`
    )
    if (!cell) {
      setRect(null)
      return
    }
    const r = cell.getBoundingClientRect()
    setRect({ top: r.top, left: r.left, width: r.width })
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [expandedCell, target, scrollContainer])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || !rect) return
    const width = Math.min(
      Math.max(rect.width, EXPANDED_CELL_MIN_WIDTH),
      window.innerWidth - VIEWPORT_PAD * 2
    )
    // Anchor at the cell's left edge; flip to its right edge, then clamp, near the viewport edges.
    const cellRight = rect.left + rect.width
    const overflowsRight = rect.left + width > window.innerWidth - VIEWPORT_PAD
    const left = Math.min(
      window.innerWidth - width - VIEWPORT_PAD,
      Math.max(VIEWPORT_PAD, overflowsRight ? cellRight - width : rect.left)
    )
    const overflowsBottom = rect.top + EXPANDED_CELL_HEIGHT > window.innerHeight - VIEWPORT_PAD
    const top = overflowsBottom
      ? Math.max(VIEWPORT_PAD, window.innerHeight - EXPANDED_CELL_HEIGHT - VIEWPORT_PAD)
      : rect.top
    root.style.setProperty('top', `${top}px`)
    root.style.setProperty('left', `${left}px`)
    root.style.setProperty('inline-size', `${width}px`)
    root.style.setProperty('block-size', `${EXPANDED_CELL_HEIGHT}px`)
  }, [rect])

  const onCloseEvent = useEffectEvent(onClose)

  useEffect(() => {
    if (!expandedCell) return
    const handleKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseEvent()
      }
    }
    const handleMouseDown = (e: MouseEvent) => {
      if (!rootRef.current) return
      if (e.target instanceof Node && rootRef.current.contains(e.target)) return
      onCloseEvent()
    }
    window.addEventListener('keydown', handleKey)
    window.addEventListener('mousedown', handleMouseDown)
    return () => {
      window.removeEventListener('keydown', handleKey)
      window.removeEventListener('mousedown', handleMouseDown)
    }
  }, [expandedCell])

  // Re-anchoring mid-scroll is more jarring than dismissing.
  useEffect(() => {
    if (!expandedCell || !scrollContainer) return
    const handler = () => onCloseEvent()
    scrollContainer.addEventListener('scroll', handler, { passive: true })
    return () => scrollContainer.removeEventListener('scroll', handler)
  }, [expandedCell, scrollContainer])

  if (!expandedCell || !target || !rect) return null

  return (
    <div
      ref={rootRef}
      role='dialog'
      aria-label={`Expanded view of ${target.column.name}`}
      className={styles.expanded}
      data-material='floating'
      data-elevation='menu'
    >
      {isEditable ? (
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
          saveBlockedReason={saveBlockedReason}
          onClose={onClose}
          textareaRef={textareaRef}
        />
      ) : (
        <>
          <div className={styles.expandedBody}>
            {displayText ? (
              <pre className={styles.expandedText} data-type='T060'>
                {displayText}
              </pre>
            ) : (
              <span className={styles.expandedEmpty} data-type='T060'>
                (empty)
              </span>
            )}
          </div>
          <div className={styles.expandedFooter}>
            <span />
            <Button variant='quiet' size='compact' onClick={onClose}>
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
  onSave: ExpandedCellProps['onSave']
  saveBlockedReason?: string
  onClose: () => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
}

/**
 * The editable body. Keyed on the edited cell so the draft survives unrelated row refetches (event
 * stream patches) while it is open, and resets only when the target cell changes.
 */
function ExpandedCellEditor({
  initialValue,
  column,
  rowId,
  onSave,
  saveBlockedReason,
  onClose,
  textareaRef,
}: ExpandedCellEditorProps) {
  const [draftValue, setDraftValue] = useState(initialValue)
  const [parseError, setParseError] = useState<string | null>(null)
  const timeZone = useTimezone()

  const handleSave = () => {
    if (saveBlockedReason) return
    // An untouched draft closes without writing, which also keeps a date's stored offset.
    if (draftValue === initialValue) {
      onClose()
      return
    }
    // Only date columns go through the date parser, so a number draft like "2024" can't reach it.
    const raw =
      column.type === 'date' ? (displayToStorage(draftValue, timeZone) ?? draftValue) : draftValue
    let cleaned: unknown
    try {
      cleaned = cleanCellValue(raw, column, timeZone)
    } catch {
      setParseError('Invalid JSON')
      return
    }
    if (cleaned === null && draftValue.trim() !== '') {
      const message = columnTypeOf(column).parseErrorMessage
      if (message) {
        setParseError(message)
        return
      }
    }
    onSave(rowId, column.key, cleaned, 'blur')
    onClose()
  }

  const handleTextareaKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSave()
    }
  }

  return (
    <>
      <textarea
        ref={textareaRef}
        aria-label={column.name}
        value={draftValue}
        onChange={(e) => {
          setDraftValue(e.target.value)
          setParseError(null)
        }}
        onKeyDown={handleTextareaKeyDown}
        readOnly={Boolean(saveBlockedReason)}
        className={styles.expandedInput}
        data-type='T060'
        spellCheck={false}
        autoCorrect='off'
      />
      <div className={styles.expandedFooter}>
        {parseError ? (
          <span className={styles.expandedError} data-type='T052'>
            {parseError}
          </span>
        ) : saveBlockedReason ? (
          // Saving is refused, so the save half of the shortcut hint would be wrong.
          <span className={styles.expandedHint} data-type='T052'>
            <kbd>esc</kbd> close
          </span>
        ) : (
          <span className={styles.expandedHint} data-type='T052'>
            <kbd>↵</kbd> save · <kbd>esc</kbd> cancel
          </span>
        )}
        <span className={styles.expandedActions}>
          <Button variant='quiet' size='compact' onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant='primary'
            size='compact'
            disabled={Boolean(saveBlockedReason)}
            disabledReason={saveBlockedReason}
            onClick={handleSave}
          >
            Save
          </Button>
        </span>
      </div>
    </>
  )
}
