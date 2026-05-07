'use client'

import { useRef } from 'react'
import type { RowExecutionMetadata } from '@/lib/table'
import type { SaveReason } from '../../../types'
import type { DisplayColumn } from '../types'
import { CellRender, type CellRenderKind, resolveCellRender } from './cell-render'
import { InlineEditor } from './inline-editors'

interface CellContentProps {
  value: unknown
  exec?: RowExecutionMetadata
  column: DisplayColumn
  isEditing: boolean
  initialCharacter?: string | null
  onSave: (value: unknown, reason: SaveReason) => void
  onCancel: () => void
  workflowNameById?: Record<string, string>
  /**
   * Human-readable labels for unmet deps on this row+group, used to render a
   * "Waiting" pill when the cell hasn't run because something it depends on
   * is empty. `undefined` (or empty) means no waiting state.
   */
  waitingOnLabels?: string[]
}

/**
 * Glue layer: maps cell inputs to a typed `CellRenderKind` (via the pure
 * resolver) and renders the corresponding JSX (via the dumb renderer). The
 * inline editor sits on top when `isEditing` is true. Adding a new cell
 * appearance is a three-step mechanical change in the colocated files.
 */
export function CellContent({
  value,
  exec,
  column,
  isEditing,
  initialCharacter,
  onSave,
  onCancel,
  waitingOnLabels,
}: CellContentProps) {
  const kind = useTypewriterTrigger(
    resolveCellRender({ value, exec, column, waitingOnLabels }),
    column
  )

  return (
    <>
      {isEditing && (
        <div className='absolute inset-0 z-10 flex items-start px-0'>
          <InlineEditor
            value={value}
            column={column}
            initialCharacter={initialCharacter ?? undefined}
            onSave={onSave}
            onCancel={onCancel}
          />
        </div>
      )}
      <CellRender kind={kind} isEditing={isEditing} />
    </>
  )
}

/**
 * Sets `animateMount: true` on a workflow-output `value` kind when the cell
 * just transitioned into the value state from a non-value one (queued /
 * running / waiting / error / cancelled / empty) — i.e., the worker just
 * filled it in — or when an existing value's text changed. Stays `false` on
 * initial page load (cell mounts already filled) and on no-op refetches.
 */
function useTypewriterTrigger(kind: CellRenderKind, column: DisplayColumn): CellRenderKind {
  const mountedRef = useRef(false)
  const lastKindRef = useRef<CellRenderKind['kind'] | null>(null)
  const lastValueTextRef = useRef<string | null>(null)
  if (!column.workflowGroupId) return kind
  const isFirstRender = !mountedRef.current
  mountedRef.current = true
  const prevKind = lastKindRef.current
  const prevText = lastValueTextRef.current
  lastKindRef.current = kind.kind
  if (kind.kind === 'value') lastValueTextRef.current = kind.text
  if (kind.kind !== 'value') return kind
  if (isFirstRender) return kind
  // Just transitioned into value from a non-value state, or text changed.
  const justTransitioned = prevKind !== 'value' || prevText !== kind.text
  if (!justTransitioned) return kind
  return { ...kind, animateMount: true }
}
