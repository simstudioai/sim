'use client'

import { type CSSProperties, type DragEvent, useState } from 'react'
import { Button, Chip, chipContentGap, chipContentIconClass, cn } from '@sim/emcn'
import { GripVertical, Plus, X } from '@sim/emcn/icons'
import { ModuleChooser } from '@/components/resources/interface-view/components/module-chooser'
import { ModuleRenderer } from '@/components/resources/interface-view/components/module-renderer'
import { MODULE_GUTTER_X } from '@/components/resources/interface-view/module-chrome'
import type {
  InterfaceCell as InterfaceGridCell,
  InterfaceModule,
  InterfaceModuleType,
} from '@/lib/interfaces'
import { INTERFACE_MODULE_META, INTERFACE_MODULE_ORDER } from '@/lib/interfaces/module-meta'

/**
 * The border a cell wears when it is selected, or when a drag is hovering it.
 *
 * `--text-muted` rather than a `--border-*` token, deliberately: this has to
 * read as clearly stronger than the resting `--border` in BOTH themes, and no
 * border token does. `--border-1` is *lighter* than `--border` in light mode
 * (`#e0e0e0` vs `#dedede`), so it would make a selected module less visible
 * than an idle one; `--border-inverted` is near-black in light and barely
 * distinguishable in dark. `--text-muted` is the one neutral grey that moves
 * away from the surface in both (`#707070` light, `#787878` dark).
 */
const SELECTION_BORDER_CLASS = 'border-[var(--text-muted)]'

export interface InterfaceCellProps {
  /** Top-left corner of the area this element covers — its drop target. */
  cell: InterfaceGridCell
  /**
   * Grid placement, carried as the `--cell-row` / `--cell-col` custom
   * properties the classes below consume. An occupied cell spans its module's
   * whole rectangle; a vacant one is always a single square.
   */
  style: CSSProperties
  /** null = empty cell → dashed placeholder resting as a `+`. */
  module: InterfaceModule | null
  selected: boolean
  canEdit: boolean
  /** Whether the module mounted in this cell is live for the viewer. */
  canRun: boolean
  onSelect: () => void
  onAddModule: (type: InterfaceModuleType) => void
  /**
   * Applies a config edit the module made about itself. Passed straight to the
   * renderer with its identity intact — a closure minted here would defeat
   * `ModuleRenderer`'s memo on every drag tick.
   */
  onConfigChange: (moduleId: string, config: InterfaceModule['config'], isValid: boolean) => void
  onRemove: () => void
  /** HTML5 DnD. A drag can only *start* when `canEdit`; drop targets stay wired. */
  onDragStart: () => void
  onDragEnd: () => void
  onDragOver: (event: DragEvent<HTMLDivElement>) => void
  onDrop: () => void
  isDragTarget: boolean
  isDragging: boolean
}

/**
 * One area of the authoring grid — a single square when vacant, a module's
 * whole rectangle when occupied. The cell owns the entire module frame —
 * border, selection ring, drag affordances, remove control, and the type bar —
 * so module renderers only ever paint their interior.
 *
 * Edit-mode only, by construction: preview mounts `InterfacePane` instead, so
 * none of this chrome needs a mode check and none of it can reach a visitor.
 *
 * An empty cell rests as a single `+`. Pressing it opens the module types *in
 * the cell* — a stack of full-width chips rather than a menu floating over the
 * canvas — with a dismiss in the corner that returns the cell to its resting
 * `+`. Both states accept drops, so a module can still be moved in either way.
 */
export function InterfaceCell({
  cell,
  style,
  module,
  selected,
  canEdit,
  canRun,
  onSelect,
  onAddModule,
  onConfigChange,
  onRemove,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  isDragTarget,
  isDragging,
}: InterfaceCellProps) {
  const [isChoosing, setIsChoosing] = useState(false)

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    onDrop()
  }

  if (!module) {
    const cellName = `row ${cell.row + 1}, column ${cell.col + 1}`
    return (
      <div
        style={style}
        onDragOver={onDragOver}
        onDrop={handleDrop}
        className={cn(
          'relative flex min-h-0 items-center justify-center rounded-[8px] border border-[var(--border)] border-dashed transition-colors [grid-column:var(--cell-col)] [grid-row:var(--cell-row)]',
          canEdit &&
            !isChoosing &&
            'hover-hover:border-[var(--border-1)] hover-hover:bg-[var(--surface-5)]',
          isDragTarget && `${SELECTION_BORDER_CLASS} bg-[var(--surface-5)]`
        )}
      >
        {canEdit &&
          (isChoosing ? (
            <>
              {/**
               * Anchored to the cell rather than carried inside the chooser
               * column: it dismisses the *cell's* open state, which is state the
               * column neither owns nor knows about.
               */}
              <Chip
                flush
                leftIcon={X}
                onClick={() => setIsChoosing(false)}
                aria-label={`Cancel adding a module to ${cellName}`}
                className='absolute top-2 left-2 z-10'
              />
              <ModuleChooser title='Add'>
                {INTERFACE_MODULE_ORDER.map((type) => {
                  const meta = INTERFACE_MODULE_META[type]
                  return (
                    <Chip
                      key={type}
                      active
                      fullWidth
                      flush
                      centered
                      leftIcon={meta.icon}
                      onClick={() => onAddModule(type)}
                      aria-label={`Add a ${meta.label} module to ${cellName}`}
                    >
                      {meta.label}
                    </Chip>
                  )
                })}
              </ModuleChooser>
            </>
          ) : (
            <button
              type='button'
              onClick={() => setIsChoosing(true)}
              aria-label={`Add a module to ${cellName}`}
              className='flex size-full items-center justify-center rounded-[8px]'
            >
              <Plus className='size-[14px] text-[var(--text-icon)]' />
            </button>
          ))}
      </div>
    )
  }

  const meta = INTERFACE_MODULE_META[module.type]
  const Icon = meta.icon

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    if (!canEdit) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    /** Firefox refuses to start a drag with an empty data transfer. */
    event.dataTransfer.setData('text/plain', module.id)
    onDragStart()
  }

  return (
    <div
      style={style}
      draggable={canEdit}
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={handleDrop}
      className={cn(
        'group relative flex min-h-0 flex-col overflow-hidden rounded-[8px] border bg-[var(--bg)] [grid-column:var(--cell-col)] [grid-row:var(--cell-row)]',
        selected ? SELECTION_BORDER_CLASS : 'border-[var(--border)]',
        isDragTarget && `${SELECTION_BORDER_CLASS} border-dashed`,
        isDragging && 'opacity-50'
      )}
    >
      {/**
       * `chipContentGap` so the title bar's icon↔label spacing is the chip's,
       * not a lookalike. The whole bar is the module's drag handle — the cell
       * itself carries `draggable`, so grabbing anywhere on the header works —
       * and it wears `cursor-grab` to say so. Only the remove control opts back
       * out, since it is a click target rather than a place to grab.
       */}
      <div
        className={cn(
          'flex h-[34px] shrink-0 items-center border-[var(--border)] border-b',
          MODULE_GUTTER_X,
          chipContentGap,
          canEdit && 'cursor-grab'
        )}
      >
        {/**
         * The title bar is the module's select handle. It is a real button so
         * selection is keyboard-reachable and announces its pressed state —
         * the body's pointer-capture below is a mouse convenience on top of it,
         * not the only way in.
         */}
        <button
          type='button'
          onClick={onSelect}
          aria-label={`Select ${meta.label} module`}
          aria-pressed={selected}
          className={cn('flex min-w-0 flex-1 items-center text-left', chipContentGap)}
        >
          <Icon className={chipContentIconClass} />
          <span className='min-w-0 flex-1 truncate text-[var(--text-body)] text-small'>
            {meta.label}
          </span>
        </button>
        {canEdit && (
          <GripVertical
            aria-hidden
            className={cn(
              chipContentIconClass,
              'opacity-0 transition-opacity group-hover:opacity-100'
            )}
          />
        )}
        {canEdit && (
          <Button
            variant='ghost'
            size='sm'
            onClick={onRemove}
            aria-label={`Remove ${meta.label} module`}
            className='!p-1 size-7 shrink-0 cursor-pointer opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100'
          >
            <X className='size-[14px]' />
          </Button>
        )}
      </div>
      {/**
       * Clicking anywhere in the module selects it — captured so a renderer that
       * stops propagation cannot swallow it. The body stays a plain scroll
       * container rather than sitting under an absolute overlay: an overlay is a
       * sibling of this scroller, so it would eat the wheel events an 8-field
       * form in a quarter cell needs, and it would make every renderer's inert
       * edit-mode branch unreachable. Those branches are the real inertness —
       * the form's submit and the chat composer both disable themselves on
       * `mode === 'edit'`, which is the only mode this cell ever renders in.
       */}
      <div className='min-h-0 flex-1 overflow-auto' onPointerDownCapture={onSelect}>
        <ModuleRenderer
          module={module}
          mode='edit'
          canRun={canRun}
          onConfigChange={canEdit ? onConfigChange : undefined}
        />
      </div>
    </div>
  )
}
