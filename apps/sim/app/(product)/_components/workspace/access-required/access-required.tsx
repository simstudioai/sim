'use client'

import { useState } from 'react'
import { FailureNotice } from '@sim/emcn/status'
import { useRouter } from 'next/navigation'
import { workspacePath } from '@/lib/navigation/paths'
import { RequestAccessModal } from '@/app/(product)/_components/request-access-modal/request-access-modal'
import { WorkspaceEmpty } from '@/app/(product)/_components/workspace/workspace-page/workspace-page'
import { useFeatureAccessPrompt } from '@/platform/lib/data/requests'

interface AccessRequiredProps {
  workspaceId: string
  /** The permission-group flag that closes this tab. */
  gate: 'hideTablesTab' | 'hideFilesTab' | 'hideKnowledgeBaseTab'
  onRefresh: () => void
}

/**
 * Why a workspace tab is closed to the viewer, with the request legacy's access boundary offers:
 * Request access, View request while one is pending, and Refresh access once it is allowed.
 */
export function AccessRequired({ workspaceId, gate, onRefresh }: AccessRequiredProps) {
  const router = useRouter()
  const prompt = useFeatureAccessPrompt(workspaceId, gate)
  const [requesting, setRequesting] = useState(false)
  const viewRequest = (requestId: string) =>
    router.push(
      workspacePath(workspaceId, `settings/requests?${new URLSearchParams({ requestId })}`)
    )
  if (prompt.error) return <FailureNotice message={prompt.error.message} onRetry={prompt.retry} />
  if (prompt.loading) return null
  const { pendingRequestId } = prompt
  return (
    <>
      {prompt.allowed ? (
        <WorkspaceEmpty
          title='Access updated'
          description='Refresh to load your latest permissions.'
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
    </>
  )
}
