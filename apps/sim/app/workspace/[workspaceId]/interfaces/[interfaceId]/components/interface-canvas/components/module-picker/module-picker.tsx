'use client'

import type { ReactNode } from 'react'
import { cn, Popover, PopoverContent, PopoverTrigger } from '@sim/emcn'
import { ArrowRight } from '@sim/emcn/icons'
import type { InterfaceModuleType } from '@/lib/interfaces'
import {
  INTERFACE_MODULE_META,
  INTERFACE_MODULE_ORDER,
} from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/utils'

export interface ModulePickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (type: InterfaceModuleType) => void
  /** The trigger element — rendered inside `PopoverTrigger asChild`. */
  children: ReactNode
}

/**
 * Module-type chooser opened from an empty canvas cell. Renders the same
 * icon + label + chevron row list as the home page's suggested actions, so
 * picking a module reads like every other "what do you want to build" surface.
 */
export function ModulePicker({ open, onOpenChange, onSelect, children }: ModulePickerProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align='start' sideOffset={4} className='w-auto p-0'>
        <div className='flex w-[240px] flex-col'>
          {INTERFACE_MODULE_ORDER.map((type, i) => {
            const meta = INTERFACE_MODULE_META[type]
            const Icon = meta.icon
            return (
              <button
                key={type}
                type='button'
                onClick={() => onSelect(type)}
                className={cn(
                  'flex items-center gap-2 border-[var(--divider)] px-2 py-2 text-left transition-colors hover-hover:bg-[var(--surface-5)]',
                  i > 0 && 'border-t'
                )}
              >
                <Icon className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' />
                <span className='flex-1 truncate text-[var(--text-body)] text-small'>
                  {meta.label}
                </span>
                <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
