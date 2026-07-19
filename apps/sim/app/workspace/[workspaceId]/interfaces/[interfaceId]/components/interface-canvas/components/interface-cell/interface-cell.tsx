'use client'

import { type DragEvent, useState } from 'react'
import { Button, cn } from '@sim/emcn'
import { GripVertical, Plus, X } from '@sim/emcn/icons'
import type {
  InterfaceCell as InterfaceGridCell,
  InterfaceModule,
  InterfaceModuleType,
} from '@/lib/interfaces'
import { ModulePicker } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/interface-canvas/components/module-picker'
import { ModuleRenderer } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/modules/module-renderer'
import { INTERFACE_MODULE_META } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/utils'

export interface InterfaceCellProps {
  cell: InterfaceGridCell
  /** null = empty cell → dashed placeholder + "+" that opens the picker. */
  module: InterfaceModule | null
  selected: boolean
  canEdit: boolean
  workspaceId: string
  interfaceId: string
  onSelect: () => void
  onAddModule: (type: InterfaceModuleType) => void
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
 * One slot of the authoring grid. The cell owns the entire module frame —
 * border, selection ring, drag affordances, remove control, and the type bar —
 * so module renderers only ever paint their interior.
 *
 * Edit-mode only, by construction: preview mounts `InterfacePane` instead, so
 * none of this chrome needs a mode check and none of it can reach a visitor.
 * Empty cells render the dashed add-a-module placeholder and still accept drops
 * so a module can be moved into them.
 */
export function InterfaceCell({
  cell,
  module,
  selected,
  canEdit,
  workspaceId,
  interfaceId,
  onSelect,
  onAddModule,
  onRemove,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  isDragTarget,
  isDragging,
}: InterfaceCellProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false)

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    onDrop()
  }

  const handleAddModule = (type: InterfaceModuleType) => {
    setIsPickerOpen(false)
    onAddModule(type)
  }

  if (!module) {
    return (
      <div
        onDragOver={onDragOver}
        onDrop={handleDrop}
        className={cn(
          'flex min-h-0 items-center justify-center rounded-[10px] border border-[var(--border)] border-dashed transition-colors',
          canEdit &&
            'hover-hover:border-[var(--brand-secondary)] hover-hover:bg-[var(--surface-5)]',
          isDragTarget && 'border-[var(--brand-secondary)] bg-[var(--surface-5)]'
        )}
      >
        {canEdit && (
          <ModulePicker
            open={isPickerOpen}
            onOpenChange={setIsPickerOpen}
            onSelect={handleAddModule}
          >
            <button
              type='button'
              aria-label={`Add a module to row ${cell.row + 1}, column ${cell.col + 1}`}
              className='flex size-full items-center justify-center rounded-[10px]'
            >
              <Plus className='size-[14px] text-[var(--text-icon)]' />
            </button>
          </ModulePicker>
        )}
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
      draggable={canEdit}
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={handleDrop}
      className={cn(
        'group relative flex min-h-0 flex-col overflow-hidden rounded-[10px] border bg-[var(--bg)]',
        selected ? 'border-[var(--brand-secondary)]' : 'border-[var(--border)]',
        isDragTarget && 'border-[var(--brand-secondary)] border-dashed',
        isDragging && 'opacity-50'
      )}
    >
      <div className='flex h-[34px] shrink-0 items-center gap-1.5 border-[var(--border)] border-b px-2'>
        {canEdit && (
          <GripVertical className='size-[14px] shrink-0 cursor-grab text-[var(--text-icon)] opacity-0 transition-opacity group-hover:opacity-100' />
        )}
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
          className='flex min-w-0 flex-1 items-center gap-1.5 text-left'
        >
          <Icon className='size-[14px] shrink-0 text-[var(--text-icon)]' />
          <span className='min-w-0 flex-1 truncate text-[var(--text-body)] text-small'>
            {meta.label}
          </span>
        </button>
        {canEdit && (
          <Button
            variant='ghost'
            size='sm'
            onClick={onRemove}
            aria-label={`Remove ${meta.label} module`}
            className='!p-1 size-7 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100'
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
          workspaceId={workspaceId}
          interfaceId={interfaceId}
          module={module}
          mode='edit'
          canEdit={canEdit}
        />
      </div>
    </div>
  )
}
