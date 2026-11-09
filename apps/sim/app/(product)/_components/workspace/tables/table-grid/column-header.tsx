'use client'

import {
  type DragEvent,
  type MouseEvent,
  memo,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
} from 'react'
import { IconButton } from '@sim/emcn/button'
import { Icon } from '@sim/emcn/icon'
import { OverflowText } from '@sim/emcn/overflow-text'
import { Tooltip } from '@sim/emcn/tooltip'
import { columnTypeGlyph } from '@/app/(product)/_components/workspace/tables/column-types/column-types'
import { inlineStyle } from '@/app/(product)/_components/workspace/tables/table-grid/inline-style'
import styles from '@/app/(product)/_components/workspace/tables/table-grid/table-grid.module.css'
import type { ColumnSourceInfo } from '@/app/(product)/_components/workspace/tables/table-grid/use-table'
import type { DisplayColumn } from '@/platform/lib/data/tables'

/** The default column width, also the fallback for a column not yet measured. */
export const COL_WIDTH = 160

interface ColumnTypeGlyphProps {
  type: string
  /** A workflow output shows its source block's mark instead of the scalar type's glyph. */
  isWorkflowColumn?: boolean
  sourceInfo?: ColumnSourceInfo
}

/**
 * The glyph beside a column's name: the type's glyph, or for a workflow output its block's mark,
 * and a crossed-out workflow when that block no longer exists.
 */
function ColumnTypeGlyph({ type, isWorkflowColumn, sourceInfo }: ColumnTypeGlyphProps) {
  if (!isWorkflowColumn) return <Icon name={columnTypeGlyph(type)} />
  if (sourceInfo?.blockMissing) {
    return (
      <Tooltip label="This column's source block no longer exists in the workflow.">
        <span className={styles.headerGlyph}>
          <Icon name='workflow-x' />
        </span>
      </Tooltip>
    )
  }
  if (sourceInfo?.blockType) return <Icon providerId={sourceInfo.blockType} />
  return <Icon name='play' />
}

interface ColumnHeaderProps {
  column: DisplayColumn
  colIndex: number
  /** Without edit permission the header is a static label: no menu, rename, drag or pin. */
  readOnly?: boolean
  isRenaming: boolean
  isColumnSelected: boolean
  renameValue: string
  /** A workflow output column of a workflow (not enrichment) group, which shows its block's mark. */
  isWorkflowOutput: boolean
  sourceInfo?: ColumnSourceInfo
  onRenameValueChange: (value: string) => void
  onRenameSubmit: () => void
  onRenameCancel: () => void
  onColumnSelect: (colIndex: number, shiftKey: boolean) => void
  onOpenConfig: (columnName: string) => void
  /** Opens the column menu at a viewport point: under the header, or at a right-click. */
  onOpenMenu: (columnKey: string, x: number, y: number) => void
  onResizeStart: (columnKey: string) => void
  onResize: (columnKey: string, width: number) => void
  onResizeEnd: () => void
  onAutoResize: (columnKey: string) => void
  onDragStart?: (columnName: string) => void
  onDragOver?: (columnName: string, side: 'left' | 'right') => void
  onDragEnd?: () => void
  onDragLeave?: () => void
  /** The name a drag shows: a workflow output drags its whole group, so it shows the group's. */
  dragLabel: string
  /** Sticky `left` when the column is pinned. */
  stickyLeft?: number
  /** The rightmost pinned column, which draws the frozen zone's edge. */
  isLastPinned?: boolean
}

/** Paints the drag image off-screen with the grid's own class, then removes it. */
export function setDragGhost(event: DragEvent, label: string) {
  const ghost = document.createElement('div')
  ghost.textContent = label
  ghost.className = styles.dragGhost
  ghost.dataset.type = 'T060'
  const host = event.currentTarget.closest('[data-emcn]') ?? document.body
  host.appendChild(ghost)
  event.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2)
  requestAnimationFrame(() => ghost.remove())
}

/**
 * One column's header cell: the label (which selects the column and opens its settings), the
 * chevron menu, rename, the drag handle and the resize grip. It captures the pointer for resize
 * because the gesture moves across sibling headers.
 */
export const ColumnHeader = memo(function ColumnHeader({
  column,
  colIndex,
  readOnly,
  isRenaming,
  isColumnSelected,
  renameValue,
  isWorkflowOutput,
  sourceInfo,
  onRenameValueChange,
  onRenameSubmit,
  onRenameCancel,
  onColumnSelect,
  onOpenConfig,
  onOpenMenu,
  onResizeStart,
  onResize,
  onResizeEnd,
  onAutoResize,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDragLeave,
  dragLabel,
  stickyLeft,
  isLastPinned,
}: ColumnHeaderProps) {
  const renameInputRef = useRef<HTMLInputElement>(null)
  const didDragRef = useRef(false)

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [isRenaming])

  const handleResizePointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      const startX = e.clientX
      const th = e.currentTarget.closest('th')
      const startWidth = th ? th.getBoundingClientRect().width : COL_WIDTH
      const target = e.currentTarget
      target.setPointerCapture(e.pointerId)
      onResizeStart(column.key)
      const handlePointerMove = (ev: globalThis.PointerEvent) => {
        onResize(column.key, startWidth + (ev.clientX - startX))
      }
      const cleanup = () => {
        target.removeEventListener('pointermove', handlePointerMove)
        target.removeEventListener('pointerup', cleanup)
        target.removeEventListener('pointercancel', cleanup)
        onResizeEnd()
      }
      target.addEventListener('pointermove', handlePointerMove)
      target.addEventListener('pointerup', cleanup)
      target.addEventListener('pointercancel', cleanup)
    },
    [column.key, onResizeStart, onResize, onResizeEnd]
  )

  const handleDragStart = (e: DragEvent<HTMLTableCellElement>) => {
    if (readOnly || isRenaming || !onDragStart) {
      e.preventDefault()
      return
    }
    didDragRef.current = true
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', column.key)
    setDragGhost(e, dragLabel)
    onDragStart(column.key)
  }

  const handleDragOver = (e: DragEvent<HTMLTableCellElement>) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    onDragOver?.(column.key, e.clientX < rect.left + rect.width / 2 ? 'left' : 'right')
  }

  const handleDragLeave = (e: DragEvent<HTMLTableCellElement>) => {
    const related = e.relatedTarget
    if (related instanceof Node && e.currentTarget.contains(related)) return
    // Moving onto another header: its dragover sets the target, and clearing here would flicker.
    if (related instanceof Element && related.closest('th')) return
    onDragLeave?.()
  }

  function handleHeaderClick(e: MouseEvent) {
    if (didDragRef.current) {
      didDragRef.current = false
      return
    }
    if (isRenaming) return
    onColumnSelect(colIndex, e.shiftKey)
    if (!e.shiftKey) onOpenConfig(column.key)
  }

  function handleChevronClick(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation()
    const rect = e.currentTarget.closest('th')?.getBoundingClientRect()
    if (rect) onOpenMenu(column.key, rect.left, rect.bottom)
  }

  function handleContextMenu(e: MouseEvent) {
    if (readOnly || isRenaming) return
    e.preventDefault()
    e.stopPropagation()
    onOpenMenu(column.key, e.clientX, e.clientY)
  }

  const label = column.workflowGroupId ? column.headerLabel : column.name
  const glyph = (
    <ColumnTypeGlyph
      type={column.type}
      isWorkflowColumn={isWorkflowOutput}
      sourceInfo={sourceInfo}
    />
  )

  return (
    <th
      data-column-drag-target={column.key}
      data-column-drag-group={column.workflowGroupId}
      data-pinned={stickyLeft !== undefined || undefined}
      data-pinned-edge={isLastPinned || undefined}
      className={styles.headerCell}
      ref={inlineStyle('left', stickyLeft !== undefined ? `${stickyLeft}px` : null)}
      draggable={!readOnly && !isRenaming}
      onDragStart={handleDragStart}
      onDragEnd={() => {
        didDragRef.current = false
        onDragEnd?.()
      }}
      onDragOver={handleDragOver}
      onDrop={(e) => e.preventDefault()}
      onDragLeave={handleDragLeave}
      onContextMenu={handleContextMenu}
    >
      {isColumnSelected && <div className={styles.headerTint} aria-hidden='true' />}
      {isRenaming ? (
        <div className={styles.headerContent}>
          {glyph}
          <input
            ref={renameInputRef}
            type='text'
            aria-label={`Rename ${column.name}`}
            value={renameValue}
            onChange={(e) => onRenameValueChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameSubmit()
              if (e.key === 'Escape') onRenameCancel()
            }}
            onBlur={onRenameSubmit}
            className={styles.renameInput}
            data-type='T060'
          />
        </div>
      ) : readOnly ? (
        <div className={styles.headerContent}>
          {glyph}
          <span className={styles.headerLabel} data-type='T060'>
            <OverflowText text={label}>{label}</OverflowText>
          </span>
        </div>
      ) : (
        <div className={styles.headerRow}>
          <button
            type='button'
            className={styles.headerButton}
            onClick={handleHeaderClick}
            draggable={false}
          >
            {glyph}
            <span className={styles.headerLabel} data-type='T060'>
              <OverflowText text={label}>{label}</OverflowText>
            </span>
          </button>
          <span className={styles.headerChevron}>
            <IconButton
              label='Column options'
              icon='I051'
              size='compact'
              render={<button type='button' draggable={false} />}
              onClick={handleChevronClick}
            />
          </span>
        </div>
      )}
      <div
        className={styles.resizeGrip}
        draggable={false}
        onDragStart={(e) => e.stopPropagation()}
        onPointerDown={handleResizePointerDown}
        onDoubleClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onAutoResize(column.key)
        }}
      />
    </th>
  )
})
