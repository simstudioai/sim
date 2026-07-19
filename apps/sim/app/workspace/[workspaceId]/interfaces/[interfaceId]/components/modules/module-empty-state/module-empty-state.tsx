import type React from 'react'

export interface ModuleEmptyStateProps {
  icon: React.ComponentType<{ className?: string }>
  message: string
}

/**
 * The placeholder every module renderer falls back to — an unconfigured module,
 * a reference to a resource that has since been deleted, or an empty result.
 *
 * Module renderers draw their **interior only**: the frame (border, radius,
 * selection ring, title bar) belongs to the canvas cell, so this fills its
 * parent and never draws chrome of its own.
 */
export function ModuleEmptyState({ icon: Icon, message }: ModuleEmptyStateProps) {
  return (
    <div className='flex h-full flex-col items-center justify-center gap-2 p-4 text-center'>
      <Icon className='size-[20px] text-[var(--text-icon)]' />
      <p className='text-[var(--text-placeholder)] text-small'>{message}</p>
    </div>
  )
}
