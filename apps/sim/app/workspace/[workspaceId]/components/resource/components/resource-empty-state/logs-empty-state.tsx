import { EmptyState } from '@/components/empty-state/empty-state'
import {
  Bar,
  Vignette,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/vignette'

interface LogRow {
  status: 'success' | 'error'
  /** Width of the workflow-name skeleton. */
  name: number
  /** Trace span offset and width — together these read as a waterfall. */
  spanStart: number
  spanWidth: number
  duration: number
}

const LOG_ROWS: LogRow[] = [
  { status: 'success', name: 68, spanStart: 0, spanWidth: 118, duration: 22 },
  { status: 'success', name: 52, spanStart: 12, spanWidth: 82, duration: 18 },
  { status: 'error', name: 74, spanStart: 24, spanWidth: 50, duration: 26 },
  { status: 'success', name: 58, spanStart: 14, spanWidth: 72, duration: 16 },
  { status: 'success', name: 64, spanStart: 4, spanWidth: 102, duration: 20 },
]

const SPAN_ORIGIN_X = 150

/**
 * Runs stacked newest-first, each one a status dot, a workflow name, and its
 * trace span — the spans stagger into the waterfall you get when you open a run.
 */
function LogsGraphic() {
  return (
    <Vignette>
      {LOG_ROWS.map((row, index) => (
        <div
          key={`${row.name}-${index}`}
          className='absolute left-0 flex h-[24px] w-full items-center'
          style={{ top: 12 + index * 26 }}
        >
          <span
            className='absolute size-[6px] rounded-full'
            style={{
              left: 44,
              background: row.status === 'error' ? 'var(--text-error)' : 'var(--text-success)',
            }}
          />
          <Bar className='absolute h-2' style={{ left: 60, width: row.name }} />
          <span
            className='absolute h-[10px] rounded-[3px] bg-[var(--surface-5)]'
            style={{ left: SPAN_ORIGIN_X + row.spanStart, width: row.spanWidth }}
          />
          <Bar className='absolute h-2' style={{ left: 286, width: row.duration }} />
        </div>
      ))}
    </Vignette>
  )
}

/** Empty state for the logs list when the workspace has no runs yet. */
export function LogsEmptyState() {
  return (
    <EmptyState
      graphic={<LogsGraphic />}
      title='No runs yet'
      description='Every workflow execution lands here, traced block by block.'
    />
  )
}
