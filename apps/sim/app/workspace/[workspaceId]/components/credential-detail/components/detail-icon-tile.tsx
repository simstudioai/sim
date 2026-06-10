import type { ComponentType } from 'react'

interface DetailIconTileProps {
  icon: ComponentType<{ className?: string }>
}

/** Square tile with a centered icon, used as a detail header's leading visual. */
export function DetailIconTile({ icon: Icon }: DetailIconTileProps) {
  return (
    <div className='flex size-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--surface-5)]'>
      <Icon className='size-[18px] text-[var(--text-tertiary)]' />
    </div>
  )
}
