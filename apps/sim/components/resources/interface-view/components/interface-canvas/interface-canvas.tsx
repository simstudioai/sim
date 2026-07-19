'use client'

import { type CSSProperties, type DragEvent, useMemo, useState } from 'react'
import { InterfaceCell } from '@/components/resources/interface-view/components/interface-canvas/components/interface-cell'
import { InterfacePreviewGrid } from '@/components/resources/interface-view/components/interface-preview-grid'
import { DEFAULT_MODULE_SPAN } from '@/lib/interfaces/constants'
import { cellKey, freeCells } from '@/lib/interfaces/geometry'
import type {
  InterfaceCell as InterfaceGridCell,
  InterfaceLayout,
  InterfaceMode,
  InterfaceModule,
  InterfaceModuleType,
  InterfacePlacement,
} from '@/lib/interfaces/types'

const CANVAS_ROOT_CLASS = 'relative min-w-0 flex-1 overflow-auto p-4'

const GRID_CLASS =
  'grid h-full min-h-0 gap-2 [grid-template-columns:repeat(var(--interface-cols),minmax(0,1fr))] [grid-template-rows:repeat(var(--interface-rows),minmax(0,1fr))]'

/** Grid-area custom properties for one authored placement. */
function placementStyle(placement: InterfacePlacement): CSSProperties {
  return {
    '--cell-row': `${placement.row + 1} / span ${placement.rowSpan}`,
    '--cell-col': `${placement.col + 1} / span ${placement.colSpan}`,
  } as CSSProperties
}

export interface InterfaceCanvasProps {
  layout: InterfaceLayout
  mode: InterfaceMode
  /** null = nothing selected; the inspector shows its empty state. */
  selectedModuleId: string | null
  onSelectModule: (moduleId: string | null) => void
  onAddModule: (type: InterfaceModuleType, cell: InterfaceGridCell) => void
  onMoveModule: (moduleId: string, cell: InterfaceGridCell) => void
  onRemoveModule: (moduleId: string) => void
  /** Applies a config edit a module made about itself from inside the canvas. */
  onUpdateModuleConfig: (
    moduleId: string,
    config: InterfaceModule['config'],
    isValid: boolean
  ) => void
  /** `grants.write`. When false the canvas is read-only in both modes. */
  canEdit: boolean
  /** Whether the interactive modules are live for this viewer. */
  canRun: boolean
}

/**
 * The interface grid, in whichever of its two forms the mode calls for.
 *
 * Edit mode paints the authoring grid through `InterfaceCell` — each module
 * renders at its own placement inside a frame with a type bar, drag handle,
 * and remove control, and every cell no module covers renders the dashed
 * add-a-module placeholder — so the page's shape stays visible while
 * composing. The track counts come from `layout.grid`, and a module is drawn
 * from its rectangle rather than one element per square, so a wider grid or a
 * module that spans tracks needs nothing here.
 *
 * Preview mode renders the shipped page instead: `collapseLayout` drops
 * empty tracks and spans lone modules across their row so nothing has a hole in
 * it, and each module is mounted by `InterfacePane`, which carries no authoring
 * affordances at all. The two surfaces are separate components rather than one
 * component switched off, so no edit chrome can leak into what a visitor sees.
 *
 * Modules keep their component identity across the mode toggle and across drags
 * because both surfaces key on module id, so an in-flight chat stream survives
 * both.
 *
 * Nothing here carries an address: the renderers resolve their data from the
 * surrounding `ResourceProvider`, which is what lets the public share page
 * mount the very same components against token-scoped endpoints.
 */
export function InterfaceCanvas({
  layout,
  mode,
  selectedModuleId,
  onSelectModule,
  onAddModule,
  onMoveModule,
  onRemoveModule,
  onUpdateModuleConfig,
  canEdit,
  canRun,
}: InterfaceCanvasProps) {
  const [draggingModuleId, setDraggingModuleId] = useState<string | null>(null)
  const [dragOverCellKey, setDragOverCellKey] = useState<string | null>(null)

  /** Computed before the preview branch so the hook order stays unconditional. */
  const vacant = useMemo(() => freeCells(layout), [layout])

  if (mode === 'preview') {
    return <InterfacePreviewGrid layout={layout} canRun={canRun} />
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
    const dragged = layout.modules.find((module) => module.id === moduleId)
    if (!dragged) return
    if (dragged.placement.row === cell.row && dragged.placement.col === cell.col) return
    onMoveModule(moduleId, cell)
  }

  /**
   * A module is one element covering its whole rectangle, so a drop anywhere on
   * it targets its top-left corner — the same corner `moveModule` places the
   * dragged module's own corner on.
   */
  const renderCell = (placement: InterfacePlacement, module: InterfaceModule | null) => {
    const cell: InterfaceGridCell = { row: placement.row, col: placement.col }
    return (
      <InterfaceCell
        key={module ? module.id : cellKey(cell)}
        cell={cell}
        style={placementStyle(placement)}
        module={module}
        selected={module !== null && module.id === selectedModuleId}
        canEdit={canEdit}
        canRun={canRun}
        onSelect={() => onSelectModule(module ? module.id : null)}
        onAddModule={(type) => onAddModule(type, cell)}
        onConfigChange={onUpdateModuleConfig}
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
  }

  return (
    <div className={CANVAS_ROOT_CLASS}>
      <div
        style={
          {
            '--interface-cols': layout.grid.cols,
            '--interface-rows': layout.grid.rows,
          } as CSSProperties
        }
        className={GRID_CLASS}
      >
        {layout.modules.map((module) => renderCell(module.placement, module))}
        {vacant.map((cell) => renderCell({ ...cell, ...DEFAULT_MODULE_SPAN }, null))}
      </div>
    </div>
  )
}
