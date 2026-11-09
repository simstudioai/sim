'use client'

import { type ReactNode, useState } from 'react'
import { useRouter } from 'next/navigation'
import { RequestAccessModal } from '@/platform/app/(shell)/_components/request-access-modal/request-access-modal'
import {
  LiveWorkspacePage,
  WorkspaceEmpty,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-page/workspace-page'
import { useResourceListAccess } from '@/platform/lib/data/folders'
import { useFeatureAccessPrompt } from '@/platform/lib/data/requests'
import { workspacePath } from '@/platform/lib/workspace-navigation'

interface AccessRequiredProps {
  workspaceId: string
  refreshing: boolean
  onRefresh: () => void
}

/** Why the changelog is closed to the viewer, with the request legacy's access boundary offers. */
function AccessRequired({ workspaceId, refreshing, onRefresh }: AccessRequiredProps) {
  const router = useRouter()
  const prompt = useFeatureAccessPrompt(workspaceId, 'hideFilesTab')
  const [requesting, setRequesting] = useState(false)
  const viewRequest = (requestId: string) =>
    router.push(
      workspacePath(workspaceId, `settings/requests?${new URLSearchParams({ requestId })}`)
    )
  const { pendingRequestId } = prompt
  const read = prompt.error
    ? {
        status: 'error' as const,
        message: prompt.error.message,
        onRetry: prompt.retry,
      }
    : prompt.loading
      ? { status: 'pending' as const }
      : undefined
  return (
    <LiveWorkspacePage workspaceId={workspaceId} current='changelog' read={read}>
      {prompt.allowed ? (
        <WorkspaceEmpty
          title='Access updated'
          description={
            refreshing
              ? 'Refreshing your permissions...'
              : 'Refresh to load your latest permissions.'
          }
          action={{ label: 'Refresh access', onClick: onRefresh }}
        />
      ) : (
        <WorkspaceEmpty
          title='Access required'
          description={prompt.description}
          action={
            pendingRequestId
              ? { label: 'View request', onClick: () => viewRequest(pendingRequestId) }
              : prompt.canRequest
                ? { label: 'Request access', onClick: () => setRequesting(true) }
                : undefined
          }
        />
      )}
      {requesting && (
        <RequestAccessModal
          scope={{ kind: 'workspace', workspaceId }}
          target={prompt.target}
          label={prompt.label}
          onViewRequest={viewRequest}
          onClose={() => setRequesting(false)}
        />
      )}
    </LiveWorkspacePage>
  )
}

interface ChangelogAccessProps {
  workspaceId: string
  children: ReactNode
}

/**
 * The changelog's release notes are workspace files, so a permission group that hides Files closes
 * the changelog too, as legacy's does. Nothing below mounts until the policy answers.
 */
export function ChangelogAccess({ workspaceId, children }: ChangelogAccessProps) {
  const access = useResourceListAccess(workspaceId, 'hideFilesTab')
  if (!access.settled) return <LiveWorkspacePage workspaceId={workspaceId} current='changelog' />
  if (access.hidden)
    return (
      <AccessRequired
        workspaceId={workspaceId}
        refreshing={access.refreshing}
        onRefresh={access.refresh}
      />
    )
  return children
}
