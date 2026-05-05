import type { SVGProps } from 'react'
import { cn } from '@/lib/core/utils/cn'

type TaskStatus = 'active' | 'unread' | 'done'

const STATUS_COLOR_CLASS: Record<TaskStatus, string> = {
  active: 'text-yellow-500',
  unread: 'text-[var(--brand-accent)]',
  done: 'text-[var(--text-icon)]',
}

interface TaskStatusDotProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  isActive?: boolean
  isUnread?: boolean
}

/**
 * Linear-style task status indicator.
 *
 * - **active** — outlined ring with a play wedge (in progress).
 * - **unread** — outlined ring with a half-pie fill (started, awaiting attention).
 * - **done** — filled disc with an inverse-color check (settled).
 *
 * Renders as a 16×16 SVG so it slots into rows beside other 16/14px row icons.
 * Override size via `className` (e.g. `h-[14px] w-[14px]`) — the SVG scales.
 */
export function TaskStatusDot({ isActive, isUnread, className, ...props }: TaskStatusDotProps) {
  const status: TaskStatus = isActive ? 'active' : isUnread ? 'unread' : 'done'

  return (
    <svg
      aria-hidden='true'
      viewBox='0 0 16 16'
      fill='none'
      className={cn('h-[16px] w-[16px] flex-shrink-0', STATUS_COLOR_CLASS[status], className)}
      {...props}
    >
      {status === 'done' ? (
        <>
          <circle cx='8' cy='8' r='7' fill='currentColor' />
          <path
            d='M4.75 8.25 L6.85 10.35 L11.25 5.95'
            stroke='var(--text-inverse)'
            strokeWidth='1.5'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        </>
      ) : (
        <>
          <circle cx='8' cy='8' r='6.5' stroke='currentColor' strokeWidth='1.5' />
          {status === 'active' ? (
            <path d='M6.75 5.5 L10.5 8 L6.75 10.5 Z' fill='currentColor' />
          ) : (
            <path d='M8 3.25 A 4.75 4.75 0 0 1 8 12.75 Z' fill='currentColor' />
          )}
        </>
      )}
    </svg>
  )
}
