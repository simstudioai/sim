'use client'

import { EmptyState } from '@sim/emcn/empty-state'
import { FailureNotice } from '@sim/emcn/status'
import { workspacePath } from '@/lib/navigation/paths'
import styles from '@/app/(product)/_components/chat/panel/workspace-resource/workspace-resource.module.css'
import { LiveRun } from '@/app/(product)/workspace/[workspaceId]/logs/_components/live-run/live-run'
import { useLogResourceExecution } from '@/platform/lib/data/logs'

interface LogResourceProps {
  workspaceId: string
  logId: string
  executionId?: string
}

/** A run the chat opened, as its Logs page shows it; Back opens that page. */
export function LogResource({ workspaceId, logId, executionId }: LogResourceProps) {
  const resolved = useLogResourceExecution(workspaceId, logId, executionId)
  if (resolved.missing)
    return (
      <EmptyState
        title='Log not found'
        description='This log may have been deleted or is no longer available.'
      />
    )
  if (resolved.read.status === 'error')
    return (
      <div className={styles.notice}>
        <FailureNotice
          message={resolved.read.message}
          retrying={resolved.read.retrying}
          onRetry={resolved.read.onRetry}
        />
      </div>
    )
  if (!resolved.executionId) return null
  return (
    <LiveRun
      workspaceId={workspaceId}
      executionId={resolved.executionId}
      back={{
        href: workspacePath(workspaceId, `logs/${encodeURIComponent(resolved.executionId)}`),
        label: 'Logs',
      }}
    />
  )
}
