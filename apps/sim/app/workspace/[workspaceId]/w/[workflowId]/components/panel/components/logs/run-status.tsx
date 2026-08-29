'use client'

import { Badge } from '@sim/emcn'
import { STATUS_CONFIG } from '@/app/workspace/[workspaceId]/logs/utils'
import type {
  PrototypeRunStatus,
  PrototypeStepStatus,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/logs/prototype-data'

/**
 * The atoms the run list and the run detail both draw with. They live apart from
 * either so the two can import them without importing each other.
 */

export function getStatusLabel(status: PrototypeRunStatus | PrototypeStepStatus) {
  if (status === 'error') return 'Failed'
  if (status === 'warning') return 'Retried'
  if (status === 'running') return 'Running'
  if (status === 'paused') return 'Paused'
  if (status === 'skipped') return 'Skipped'
  return 'Completed'
}

/**
 * Status colours come from the Logs page's own `STATUS_CONFIG` so the two
 * surfaces never drift. Note what that config does NOT contain: a green. A run
 * that finished takes the same muted dot the Logs table gives it — colour is
 * spent on the runs that need attention, and a column of green ticks spends it
 * on the ones that do not.
 */
const STATUS_DOT_COLOR: Record<PrototypeRunStatus | PrototypeStepStatus, string | null> = {
  error: STATUS_CONFIG.error.color,
  warning: STATUS_CONFIG.pending.color,
  running: STATUS_CONFIG.running.color,
  paused: STATUS_CONFIG.pending.color,
  success: STATUS_CONFIG.info.color,
  /* Never ran, so it has no outcome to colour. */
  skipped: null,
}

/**
 * A run's or step's outcome, in the dot the rest of the product already uses for
 * it. Sized to the 14px slot an icon occupied, so rows keep their alignment.
 */
export function StatusIcon({ status }: { status: PrototypeRunStatus | PrototypeStepStatus }) {
  const color = STATUS_DOT_COLOR[status]

  if (!color) {
    return <span className='size-[14px] text-center text-[var(--text-muted)] text-caption'>—</span>
  }

  return (
    <span
      className='flex size-[14px] items-center justify-center'
      role='img'
      aria-label={getStatusLabel(status)}
    >
      <span className='size-[6px] rounded-full' style={{ backgroundColor: color }} />
    </span>
  )
}

/**
 * Run status in the canonical `Badge`, with its colour pulled from the Logs
 * page's own `STATUS_CONFIG` so the two surfaces cannot drift apart.
 *
 * The labels are this surface's own. `LogStatus` has no `paused` (the record
 * carries that as `hasPendingPause`, a separate axis), and its success case is
 * literally labelled "Info" — accurate for a log level, wrong for a run that
 * finished. So the config supplies the colour and this supplies the word.
 */
const RUN_STATUS_BADGE: Record<
  PrototypeRunStatus | PrototypeStepStatus,
  { variant: (typeof STATUS_CONFIG)[keyof typeof STATUS_CONFIG]['variant']; label: string }
> = {
  error: { variant: STATUS_CONFIG.error.variant, label: 'Failed' },
  /*
   * Grey, not green — the same call the status dots make, and the same one the
   * Logs table makes with its own `info` variant. Red is reserved for the runs
   * that need attention; a badge that finished says so in the word.
   */
  success: { variant: STATUS_CONFIG.info.variant, label: 'Completed' },
  running: { variant: STATUS_CONFIG.info.variant, label: 'Running' },
  paused: { variant: STATUS_CONFIG.info.variant, label: 'Paused' },
  /* Step-only outcomes, so the inspector can badge a nested span too. */
  warning: { variant: STATUS_CONFIG.pending.variant, label: 'Retried' },
  skipped: { variant: STATUS_CONFIG.info.variant, label: 'Skipped' },
}

export function RunStatusBadge({ status }: { status: PrototypeRunStatus | PrototypeStepStatus }) {
  const badge = RUN_STATUS_BADGE[status]
  return (
    <Badge variant={badge.variant} dot size='sm'>
      {badge.label}
    </Badge>
  )
}

export function RunStat({ label, value }: { label: string; value: string }) {
  return (
    <div className='min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5'>
      <p className='truncate text-[var(--text-tertiary)] text-caption'>{label}</p>
      <p className='truncate text-[var(--text-primary)] text-base tabular-nums'>{value}</p>
    </div>
  )
}
