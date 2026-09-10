import type { ReactNode } from 'react'
import { ShimmerText } from '@/components/ui/shimmer-text'

interface ActivityStatusProps {
  label: string
  isActive: boolean
  icon?: ReactNode
}

/** Inline tool status with the shared shimmer while active. */
export function ActivityStatus({ label, isActive, icon }: ActivityStatusProps) {
  return (
    <div role='status' className='flex min-w-0 items-center gap-[6px]'>
      {icon}
      {isActive ? (
        <ShimmerText className='min-w-0 truncate text-small leading-[18px] [--shimmer-rest:var(--text-secondary)]'>
          {label}
        </ShimmerText>
      ) : (
        <span className='min-w-0 truncate text-[var(--text-secondary)] text-small leading-[18px]'>
          {label}
        </span>
      )}
    </div>
  )
}
