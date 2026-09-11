import type { ReactNode } from 'react'
import { OverflowText } from '@sim/emcn'
import { ShimmerText } from '@/components/ui/shimmer-text'

interface ActivityStatusProps {
  label: string
  isActive: boolean
  icon?: ReactNode
}

/** Inline tool status with the shared shimmer while active. */
export function ActivityStatus({ label, isActive, icon }: ActivityStatusProps) {
  return (
    <span role='status' className='flex min-w-0 items-center gap-2'>
      {icon}
      <OverflowText
        label={label}
        className='text-[var(--text-tertiary)] text-base leading-5 group-hover/agent:text-[var(--text-body)]'
        focusTarget='nearest-interactive'
      >
        {isActive ? (
          <ShimmerText className='[--shimmer-rest:var(--text-tertiary)]'>{label}</ShimmerText>
        ) : undefined}
      </OverflowText>
    </span>
  )
}
