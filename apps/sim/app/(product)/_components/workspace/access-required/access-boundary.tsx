'use client'

import type { ComponentProps, ReactNode } from 'react'
import { AccessRequired } from '@/app/(product)/_components/workspace/access-required/access-required'
import { LiveWorkspacePage } from '@/app/(product)/_components/workspace/workspace-page/workspace-page'
import { useResourceListAccess } from '@/platform/lib/data/folders'

interface AccessBoundaryProps {
  workspaceId: string
  /** The permission-group flag that closes this page. */
  gate: ComponentProps<typeof AccessRequired>['gate']
  /** The tab whose frame holds the prompt. */
  current: ComponentProps<typeof LiveWorkspacePage>['current']
  layout?: ComponentProps<typeof LiveWorkspacePage>['layout']
  children: ReactNode
}

/**
 * Legacy's `PermissionAccessBoundary` for a page that opens one record: nothing below mounts until
 * the viewer's permission group answers, and a group that hides the tab gets the tab's frame with
 * the access prompt instead, so a hidden record's reads never start.
 */
export function AccessBoundary({
  workspaceId,
  gate,
  current,
  layout,
  children,
}: AccessBoundaryProps) {
  const access = useResourceListAccess(workspaceId, gate)
  if (!access.settled)
    return <LiveWorkspacePage workspaceId={workspaceId} current={current} layout={layout} />
  if (access.hidden)
    return (
      <LiveWorkspacePage workspaceId={workspaceId} current={current} layout={layout}>
        <AccessRequired
          workspaceId={workspaceId}
          gate={gate}
          refreshing={access.refreshing}
          onRefresh={access.refresh}
        />
      </LiveWorkspacePage>
    )
  return children
}
