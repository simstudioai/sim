import type { ComponentType } from 'react'

interface ResourceTileProps {
  icon: ComponentType<{ className?: string }>
}

/**
 * Square glyph tile identifying a workspace resource — the leading visual on a
 * resource's row and on its detail heading. Single source for that chrome so
 * the skills and custom tools surfaces cannot drift apart.
 */
export function ResourceTile({ icon: Icon }: ResourceTileProps) {
  return (
    <div className='size-9 flex-shrink-0'>
      <div className='flex size-full items-center justify-center rounded-xl border border-[var(--border-1)] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]'>
        <Icon className='size-5 text-[var(--text-icon)]' />
      </div>
    </div>
  )
}
