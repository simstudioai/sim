import { Check, Clock, cn, X } from '@sim/emcn'
import type { TaskBlockInfo } from '@/lib/mothership/request/types'

interface TaskPillProps {
  task: TaskBlockInfo
}

function describeTarget(task: TaskBlockInfo): string {
  if (task.kind === 'workflow_run') {
    const id = typeof task.target.executionId === 'string' ? task.target.executionId : ''
    return `workflow run ${id.slice(0, 8)}`
  }
  const at = typeof task.target.firesAt === 'string' ? new Date(task.target.firesAt) : null
  return at
    ? `timer · ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : 'timer'
}

/**
 * The "watching" pill under a turn that armed a background task (mothership
 * docs/revamp/21-background-tasks.md §6.4). Pending until the task's notification lands
 * in this chat, then it shows the outcome. Read-only.
 */
export function TaskPill({ task }: TaskPillProps) {
  const pending = task.status === undefined || task.status === 'pending'
  const failed = task.status === 'failed' || task.status === 'expired'
  const Icon = pending ? Clock : failed ? X : Check
  return (
    <div
      className={cn(
        'my-1 inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-[12px]',
        'border-[var(--border)] bg-[var(--bg)] text-[var(--text-secondary)]'
      )}
      title={task.note}
    >
      <Icon
        className={cn(
          'size-[12px] shrink-0',
          pending && 'animate-pulse',
          failed ? 'text-[var(--text-error)]' : 'text-[var(--text-primary)]'
        )}
      />
      <span className='truncate'>
        {pending ? 'Watching' : task.status} {describeTarget(task)}
        {task.summary ? ` · ${task.summary}` : ` · ${task.note}`}
      </span>
    </div>
  )
}
