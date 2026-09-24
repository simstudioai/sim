import type { ReactNode } from 'react'
import { cn, OverflowText } from '@sim/emcn'
import { ShimmerText } from '@/components/ui/shimmer-text'

/** The icon column every activity row shares, sized for the default 14px icon. */
export const ACTIVITY_ICON_SLOT_CLASS = 'flex size-[14px] shrink-0 items-center justify-center'

/** An activity row: the icon column, then the text column one `gap-2` to its right. */
export const ACTIVITY_ROW_CLASS = 'flex min-w-0 items-center gap-2'

/** Activity label text, muted until the row is hovered. */
export const ACTIVITY_LABEL_CLASS =
  'text-[var(--text-tertiary)] text-sm leading-5 group-hover/agent:text-[var(--text-body)]'

export interface ActivityStatusProps {
  label: string
  isActive: boolean
  icon?: ReactNode
}

/** Inline tool status with the shared shimmer while active. */
export function ActivityStatus({ label, isActive, icon }: ActivityStatusProps) {
  return (
    <span role='status' className={ACTIVITY_ROW_CLASS}>
      {icon && (
        <span
          aria-hidden='true'
          className={cn(ACTIVITY_ICON_SLOT_CLASS, 'text-[var(--text-icon)]')}
        >
          {icon}
        </span>
      )}
      <OverflowText
        label={label}
        className={ACTIVITY_LABEL_CLASS}
        focusTarget='nearest-interactive'
      >
        {isActive ? (
          <ShimmerText className='[--shimmer-rest:var(--text-tertiary)]'>{label}</ShimmerText>
        ) : undefined}
      </OverflowText>
    </span>
  )
}

interface ActivityTextColumnProps {
  children: ReactNode
}

/**
 * Places content in the activity text column by reserving the icon column, so
 * it lines up with every row's label without a hand-tuned offset.
 */
export function ActivityTextColumn({ children }: ActivityTextColumnProps) {
  return (
    <div className='flex min-w-0 items-start gap-2'>
      <span aria-hidden='true' className={ACTIVITY_ICON_SLOT_CLASS} />
      <div className='min-w-0 flex-1'>{children}</div>
    </div>
  )
}
