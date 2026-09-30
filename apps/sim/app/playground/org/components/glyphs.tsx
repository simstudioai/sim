import { cn } from '@sim/emcn'
import {
  Bell,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  Mail,
  MessageSquareText,
} from '@sim/emcn/icons'
import { SlackMonoIcon } from '@/components/icons'
import type {
  AgentState,
  FeedbackSource,
  IssueStatus,
  Priority,
} from '@/app/playground/org/lib/mock-data'

const GLYPH = 'size-[14px] shrink-0'

/** Linear-style status circle: dashed backlog, empty todo, half in-progress, filled done. */
export function StatusIcon({ status, className }: { status: IssueStatus; className?: string }) {
  if (status === 'done')
    return <CircleCheck className={cn(GLYPH, 'text-[var(--brand-blue)]', className)} />
  if (status === 'canceled')
    return <CircleX className={cn(GLYPH, 'text-[var(--text-muted)]', className)} />
  return (
    <svg viewBox='0 0 14 14' aria-hidden className={cn(GLYPH, className)}>
      <circle
        cx='7'
        cy='7'
        r='5.5'
        fill='none'
        strokeWidth='1.5'
        className={
          status === 'blocked'
            ? 'stroke-[var(--text-error)]'
            : status === 'in_progress'
              ? 'stroke-[var(--caution)]'
              : 'stroke-[var(--text-icon)]'
        }
        strokeDasharray={status === 'backlog' ? '2 2' : undefined}
      />
      {status === 'in_progress' && (
        <path d='M7 3.5 A3.5 3.5 0 0 1 7 10.5 Z' className='fill-[var(--caution)]' />
      )}
      {status === 'blocked' && (
        <path d='M4.5 9.5 L9.5 4.5' strokeWidth='1.5' className='stroke-[var(--text-error)]' />
      )}
    </svg>
  )
}

/** Signal bars for High/Medium/Low, a filled square for Urgent, dashes for none. */
export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  if (priority === 1)
    return (
      <svg viewBox='0 0 14 14' aria-hidden className={cn(GLYPH, className)}>
        <rect
          x='1.5'
          y='1.5'
          width='11'
          height='11'
          rx='2.5'
          className='fill-[var(--text-primary)]'
        />
        <path
          d='M7 4v3.6M7 9.6v.2'
          strokeWidth='1.6'
          strokeLinecap='round'
          className='stroke-[var(--bg)]'
        />
      </svg>
    )
  const filled = priority === 0 ? 0 : 5 - priority
  return (
    <svg viewBox='0 0 14 14' aria-hidden className={cn(GLYPH, className)}>
      {[0, 1, 2].map((bar) =>
        priority === 0 ? (
          <rect
            key={bar}
            x={1.5 + bar * 4}
            y='6.25'
            width='3'
            height='1.5'
            rx='0.75'
            className='fill-[var(--text-muted)]'
          />
        ) : (
          <rect
            key={bar}
            x={1.5 + bar * 4}
            y={9 - bar * 3}
            width='3'
            height={3.5 + bar * 3}
            rx='1'
            className={bar < filled ? 'fill-[var(--text-icon)]' : 'fill-[var(--surface-6)]'}
          />
        )
      )}
    </svg>
  )
}

/** Agent session state, mirroring Linear's pending/active/awaitingInput/error/complete/stale. */
export function AgentStateIcon({ state, className }: { state: AgentState; className?: string }) {
  switch (state) {
    case 'active':
      return <RunningDot className={className} />
    case 'awaitingInput':
      return <CircleAlert className={cn(GLYPH, 'text-[var(--caution)]', className)} />
    case 'error':
      return <CircleX className={cn(GLYPH, 'text-[var(--text-error)]', className)} />
    case 'complete':
      return <CircleCheck className={cn(GLYPH, 'text-[var(--success)]', className)} />
    case 'stale':
      return <Clock className={cn(GLYPH, 'text-[var(--text-muted)]', className)} />
    case 'pending':
      return <Clock className={cn(GLYPH, 'text-[var(--text-icon)]', className)} />
  }
}

export function SourceIcon({ source, className }: { source: FeedbackSource; className?: string }) {
  if (source === 'slack')
    return <SlackMonoIcon className={cn(GLYPH, 'text-[var(--text-icon)]', className)} />
  if (source === 'pagerduty')
    return <Bell className={cn(GLYPH, 'text-[var(--text-icon)]', className)} />
  if (source === 'email')
    return <Mail className={cn(GLYPH, 'text-[var(--text-icon)]', className)} />
  return <MessageSquareText className={cn(GLYPH, 'text-[var(--text-icon)]', className)} />
}

/** An agent working right now: a yellow dot, used everywhere a run is in progress. */
export function RunningDot({ className }: { className?: string }) {
  return (
    <span
      role='img'
      aria-label='Running'
      className={cn('inline-flex size-[14px] shrink-0 items-center justify-center', className)}
    >
      <span className='size-[7px] rounded-full bg-[var(--caution)]' />
    </span>
  )
}
