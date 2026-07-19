'use client'

import { type DragEvent, useState } from 'react'
import type {
  InterfaceCell as InterfaceGridCell,
  InterfaceLayout,
  InterfaceModule,
  InterfaceModuleType,
} from '@/lib/interfaces'
import { InterfaceCell } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/interface-canvas/components/interface-cell'
import { InterfacePane } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/interface-canvas/components/interface-pane'
import type { InterfaceMode } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/search-params'
import {
  cellKey,
  computePreviewLayout,
  findModuleAt,
  INTERFACE_GRID_CELLS,
} from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/utils'

const CANVAS_ROOT_CLASS = 'relative min-w-0 flex-1 overflow-auto p-4'

export interface InterfaceCanvasProps {
  workspaceId: string
  interfaceId: string
  layout: InterfaceLayout
  mode: InterfaceMode
  /** null = nothing selected; the inspector shows its empty state. */
  selectedModuleId: string | null
  onSelectModule: (moduleId: string | null) => void
  onAddModule: (type: InterfaceModuleType, cell: InterfaceGridCell) => void
  onMoveModule: (moduleId: string, cell: InterfaceGridCell) => void
  onRemoveModule: (moduleId: string) => void
  /** Workspace write permission. When false the canvas is read-only in both modes. */
  canEdit: boolean
}

/**
 * The interface grid, in whichever of its two forms the mode calls for.
 *
 * Edit mode paints the literal 2x2 authoring grid through `InterfaceCell` —
 * occupied cells render their module inside a frame with a type bar, drag
 * handle, and remove control; empty ones render the dashed add-a-module
 * placeholder — so the page's shape stays visible while composing.
 *
 * Preview mode renders the shipped page instead: `computePreviewLayout` drops
 * empty tracks and spans lone modules across their row so nothing has a hole in
 * it, and each module is mounted by `InterfacePane`, which carries no authoring
 * affordances at all. The two surfaces are separate components rather than one
 * component switched off, so no edit chrome can leak into what a visitor sees.
 *
 * Modules keep their component identity across the mode toggle and across drags
 * because both surfaces key on module id, so an in-flight chat stream survives
 * both.
 */
export function InterfaceCanvas({
  workspaceId,
  interfaceId,
  layout,
  mode,
  selectedModuleId,
  onSelectModule,
  onAddModule,
  onMoveModule,
  onRemoveModule,
  canEdit,
}: InterfaceCanvasProps) {
  const [draggingModuleId, setDraggingModuleId] = useState<string | null>(null)
  const [dragOverCellKey, setDragOverCellKey] = useState<string | null>(null)

  if (mode === 'preview') {
    const preview = computePreviewLayout(layout)

    if (preview.placements.length === 0) {
      return (
        <div className={CANVAS_ROOT_CLASS}>
          <div className='flex h-full items-center justify-center text-[var(--text-placeholder)] text-small'>
            This interface has no modules yet.
          </div>
        </div>
      )
    }

    return (
      <div className={CANVAS_ROOT_CLASS}>
        <div
          className='grid h-full min-h-0 gap-3'
          style={{
            gridTemplateColumns: `repeat(${preview.cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${preview.rows}, minmax(0, 1fr))`,
          }}
        >
          {preview.placements.map((placement) => (
            <InterfacePane
              key={placement.module.id}
              module={placement.module}
              style={{ gridRow: placement.gridRow, gridColumn: placement.gridColumn }}
              workspaceId={workspaceId}
              interfaceId={interfaceId}
              canEdit={canEdit}
            />
          ))}
        </div>
      </div>
    )
  }

  /**
   * `dragend` fires on the source cell for both a completed and a cancelled
   * drag, so it is the only teardown the highlight needs — there is no
   * `dragleave` in the cell contract.
   */
  const handleDragEnd = () => {
    setDraggingModuleId(null)
    setDragOverCellKey(null)
  }

  const handleDragOver = (cell: InterfaceGridCell) => (event: DragEvent<HTMLDivElement>) => {
    if (!canEdit || !draggingModuleId) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const key = cellKey(cell)
    setDragOverCellKey((previous) => (previous === key ? previous : key))
  }

  const handleDrop = (cell: InterfaceGridCell) => () => {
    const moduleId = draggingModuleId
    setDraggingModuleId(null)
    setDragOverCellKey(null)
    if (!canEdit || !moduleId) return
    const source = layout.modules.find((module) => module.id === moduleId)
    if (!source) return
    if (source.cell.row === cell.row && source.cell.col === cell.col) return
    onMoveModule(moduleId, cell)
  }

  const renderCell = (cell: InterfaceGridCell, module: InterfaceModule | null) => (
    <InterfaceCell
      key={module ? module.id : cellKey(cell)}
      cell={cell}
      module={module}
      selected={module !== null && module.id === selectedModuleId}
      canEdit={canEdit}
      workspaceId={workspaceId}
      interfaceId={interfaceId}
      onSelect={() => onSelectModule(module ? module.id : null)}
      onAddModule={(type) => onAddModule(type, cell)}
      onRemove={() => {
        if (module) onRemoveModule(module.id)
      }}
      onDragStart={() => {
        if (module) setDraggingModuleId(module.id)
      }}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver(cell)}
      onDrop={handleDrop(cell)}
      isDragTarget={
        canEdit && dragOverCellKey === cellKey(cell) && draggingModuleId !== (module?.id ?? null)
      }
      isDragging={module !== null && module.id === draggingModuleId}
    />
  )

  return (
    <div className={CANVAS_ROOT_CLASS}>
      <div className='grid h-full min-h-0 grid-cols-2 grid-rows-2 gap-3'>
        {INTERFACE_GRID_CELLS.map((cell) => renderCell(cell, findModuleAt(layout, cell)))}
      </div>
    </div>
  )
}
