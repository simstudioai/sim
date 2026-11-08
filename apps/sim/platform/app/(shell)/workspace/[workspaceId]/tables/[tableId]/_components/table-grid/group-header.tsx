'use client'

import { type DragEvent, type MouseEvent, useRef } from 'react'
import { Icon } from '@sim/emcn/icon'
import { OverflowText } from '@sim/emcn/overflow-text'
import type { EnrichmentMark } from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/column-types/enrichment-marks'
import { setDragGhost } from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/table-grid/column-header'
import { inlineStyle } from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/table-grid/inline-style'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/table-grid/table-grid.module.css'

interface GroupHeaderProps {
  groupId: string
  /** The group's name: the enrichment's, or the configured workflow's. */
  name: string
  /** The enrichment's mark, or the workflow glyph for a workflow group. */
  glyph: EnrichmentMark
  /** How many output columns the group spans. */
  span: number
  startColIndex: number
  columnKey: string
  isGroupSelected: boolean
  /** Without edit permission the cell neither drags nor offers runs. */
  readOnly?: boolean
  canRun: boolean
  onSelectGroup: (startColIndex: number, size: number) => void
  onOpenConfig: (groupId: string) => void
  /** Opens the group's run menu at a viewport point, under its Run action. */
  onOpenRunMenu: (groupId: string, x: number, y: number) => void
  /** Opens the group's column menu at a right-click. */
  onOpenGroupMenu?: (groupId: string, columnKey: string, x: number, y: number) => void
  onDragStart?: (columnName: string) => void
  onDragOver?: (columnName: string, side: 'left' | 'right') => void
  onDragEnd?: () => void
  onDragLeave?: () => void
  stickyLeft?: number
  isLastPinned?: boolean
}

/**
 * The meta header spanning a workflow or enrichment group's output columns, so N siblings read as
 * one unit. A click selects the group's columns and opens its settings; the group drags as one.
 */
export function GroupHeader({
  groupId,
  name,
  glyph,
  span,
  startColIndex,
  columnKey,
  isGroupSelected,
  readOnly,
  canRun,
  onSelectGroup,
  onOpenConfig,
  onOpenRunMenu,
  onOpenGroupMenu,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDragLeave,
  stickyLeft,
  isLastPinned,
}: GroupHeaderProps) {
  const didDragRef = useRef(false)
  const isDraggable = !readOnly && Boolean(onDragStart)

  function handleClick(e: MouseEvent<HTMLTableCellElement>) {
    // Only the bare cell selects the group; its Run action and portalled menus don't.
    if (e.target instanceof Element && e.target.closest('button, [role="menuitem"], [role="menu"]'))
      return
    if (didDragRef.current) {
      didDragRef.current = false
      return
    }
    onSelectGroup(startColIndex, span)
    onOpenConfig(groupId)
  }

  function handleContextMenu(e: MouseEvent) {
    if (!onOpenGroupMenu) return
    e.preventDefault()
    e.stopPropagation()
    onOpenGroupMenu(groupId, columnKey, e.clientX, e.clientY)
  }

  return (
    <th
      colSpan={span}
      data-column-drag-target={columnKey}
      data-column-drag-group={groupId}
      data-pinned={stickyLeft !== undefined || undefined}
      data-pinned-edge={isLastPinned || undefined}
      className={styles.groupCell}
      ref={inlineStyle('left', stickyLeft !== undefined ? `${stickyLeft}px` : null)}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      draggable={isDraggable}
      onDragStart={
        isDraggable
          ? (e: DragEvent<HTMLTableCellElement>) => {
              if (!onDragStart) return
              didDragRef.current = true
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', columnKey)
              setDragGhost(e, name)
              onDragStart(columnKey)
            }
          : undefined
      }
      onDragOver={
        isDraggable
          ? (e: DragEvent<HTMLTableCellElement>) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              const rect = e.currentTarget.getBoundingClientRect()
              onDragOver?.(columnKey, e.clientX < rect.left + rect.width / 2 ? 'left' : 'right')
            }
          : undefined
      }
      onDragEnd={
        isDraggable
          ? () => {
              didDragRef.current = false
              onDragEnd?.()
            }
          : undefined
      }
      onDragLeave={
        isDraggable
          ? (e: DragEvent<HTMLTableCellElement>) => {
              const related = e.relatedTarget
              if (related instanceof Node && e.currentTarget.contains(related)) return
              if (related instanceof Element && related.closest('th')) return
              onDragLeave?.()
            }
          : undefined
      }
      onDrop={isDraggable ? (e) => e.preventDefault() : undefined}
    >
      {isGroupSelected && <div className={styles.headerTint} aria-hidden='true' />}
      <div className={styles.groupContent}>
        {typeof glyph === 'string' ? <Icon name={glyph} /> : <Icon providerId={glyph.providerId} />}
        <span className={styles.groupLabel} data-type='T052'>
          <OverflowText text={name}>{name}</OverflowText>
        </span>
        {canRun && (
          <button
            type='button'
            className={styles.groupRun}
            aria-label='Run group'
            title='Run group'
            onClick={(e) => {
              e.stopPropagation()
              const rect = e.currentTarget.getBoundingClientRect()
              onOpenRunMenu(groupId, rect.left, rect.bottom)
            }}
          >
            <Icon name='play' />
          </button>
        )}
      </div>
    </th>
  )
}
