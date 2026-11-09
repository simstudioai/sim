'use client'

import type { ReactNode } from 'react'
import { AccessRequired } from '@/app/(product)/workspace/[workspaceId]/_components/access-required/access-required'
import { LiveWorkspacePage } from '@/app/(product)/workspace/[workspaceId]/_components/workspace-page/workspace-page'
import { useResourceListAccess } from '@/platform/lib/data/folders'

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
      <LiveWorkspacePage workspaceId={workspaceId} current='changelog'>
        <AccessRequired
          workspaceId={workspaceId}
          gate='hideFilesTab'
          refreshing={access.refreshing}
          onRefresh={access.refresh}
        />
      </LiveWorkspacePage>
    )
  return children
}
