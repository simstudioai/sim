'use client'

import type { RowExecutionMetadata } from '@/lib/table'
import type { SaveReason } from '../../../types'
import type { DisplayColumn } from '../types'
import { CellRender, resolveCellRender } from './cell-render'
import { InlineEditor } from './inline-editors'

interface CellContentProps {
  value: unknown
  exec?: RowExecutionMetadata
  column: DisplayColumn
  isEditing: boolean
  initialCharacter?: string | null
  onSave: (value: unknown, reason: SaveReason) => void
  onCancel: () => void
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
  const kind = resolveCellRender({ value, exec, column, waitingOnLabels })

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
