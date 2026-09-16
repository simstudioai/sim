import { Check, Clock, cn, X } from '@sim/emcn'
import type { TaskBlockInfo } from '@/lib/mothership/request/types'
import { resolveResourceDisplayName } from '@/lib/mothership/tools/client/resource-display'
import { useMothershipTaskStatus } from '@/hooks/queries/mothership-tasks'

interface TaskPillProps {
  task: TaskBlockInfo
}

function describeTarget(task: TaskBlockInfo): string {
  if (task.kind === 'workflow_run') {
    const workspaceId =
      typeof task.target.workspaceId === 'string' ? task.target.workspaceId : undefined
    const name = resolveResourceDisplayName('workflow', task.target.workflowId, { workspaceId })
    return name ? `workflow run · ${name}` : 'workflow run'
  }
  const at = typeof task.target.firesAt === 'string' ? new Date(task.target.firesAt) : null
  return at
    ? `timer · ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : 'timer'
}

/**
 * Read-only background-watch status under a turn that armed a background task (mothership
 * docs/revamp/21-background-tasks.md §6.4). Pending until the task's notification lands
 * in this chat, then it shows the outcome. The full notification remains available as detail.
 */
export function TaskPill({ task: recorded }: TaskPillProps) {
  const { data } = useMothershipTaskStatus(recorded)
  const task =
    data && (!recorded.status || recorded.status === 'pending')
      ? { ...recorded, status: data.status, summary: data.summary ?? undefined }
      : recorded
  const pending = task.status === undefined || task.status === 'pending'
  const failed = task.status === 'failed' || task.status === 'expired'
  const Icon = pending ? Clock : failed ? X : Check
  const label = {
    pending: 'Watching',
    completed: 'Completed',
    failed: 'Failed',
    stopped: 'Stopped',
    expired: 'Expired',
  }[task.status ?? 'pending']
  const target = describeTarget(task)
  return (
    <div
      className='my-1 flex max-w-full items-center gap-2 text-[12px] text-[var(--text-secondary)]'
      title={[task.summary, task.note].filter(Boolean).join('\n')}
      role='status'
      aria-label={`Background watch: ${label} ${target}`}
    >
      <Icon
        className={cn(
          'size-[12px] shrink-0',
          pending && 'animate-pulse',
          failed ? 'text-[var(--text-error)]' : 'text-[var(--text-primary)]'
        )}
      />
      <span className='truncate'>
        Background watch · {label} {target}
      </span>
    </div>
  )
}
