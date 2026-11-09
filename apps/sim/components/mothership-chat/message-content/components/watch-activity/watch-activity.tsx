import { useParams } from 'next/navigation'
import { ActivityStatus } from '@/components/ui/activity-status'
import type { TaskBlockInfo } from '@/lib/mothership/request/types'
import { resolveResourceDisplayName } from '@/lib/mothership/tools/client/resource-display'
import { useMothershipTaskStatus } from '@/hooks/queries/mothership-tasks'

interface WatchActivityProps {
  task: TaskBlockInfo
}

function watchLabel(task: TaskBlockInfo, routedWorkspaceId?: string): string {
  const status = task.status ?? 'pending'
  if (task.kind === 'workflow_run') {
    const workspaceId =
      typeof task.target.workspaceId === 'string' ? task.target.workspaceId : routedWorkspaceId
    const name = resolveResourceDisplayName('workflow', task.target.workflowId, { workspaceId })
    const target = name ? `workflow run: ${name}` : 'workflow run'
    return {
      pending: `Waiting for ${target}`,
      completed: `Completed ${target}`,
      failed: `Failed ${target}`,
      stopped: `Stopped watching ${target}`,
      expired: `Watch expired for ${target}`,
    }[status]
  }
  const at = typeof task.target.firesAt === 'string' ? new Date(task.target.firesAt) : undefined
  const time =
    at && Number.isFinite(at.getTime())
      ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : undefined
  if (status === 'pending') return time ? `Waiting until ${time}` : 'Waiting for timer'
  const label = {
    completed: 'Timer finished',
    failed: 'Timer failed',
    stopped: 'Timer stopped',
    expired: 'Timer expired',
  }[status]
  return time ? `${label} · ${time}` : label
}

/** A watch uses the normal tool row, but remains pending independently of the turn. */
export function WatchActivity({ task: recorded }: WatchActivityProps) {
  const params = useParams<{ workspaceId?: string }>()
  const { data } = useMothershipTaskStatus(recorded)
  const task =
    data && (!recorded.status || recorded.status === 'pending')
      ? { ...recorded, status: data.status, summary: data.summary ?? undefined }
      : recorded
  const pending = task.status === undefined || task.status === 'pending'
  return (
    <div
      data-chat-activity
      aria-busy={pending}
      title={[task.summary, task.note].filter(Boolean).join('\n')}
    >
      <ActivityStatus label={watchLabel(task, params?.workspaceId)} isActive={pending} />
    </div>
  )
}
