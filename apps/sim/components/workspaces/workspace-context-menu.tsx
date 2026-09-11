'use client'

import type { ComponentProps } from 'react'
import type { Workspace } from '@/lib/api/contracts/workspaces'
import { ContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/context-menu/context-menu'

interface WorkspaceContextMenuProps
  extends Omit<
    ComponentProps<typeof ContextMenu>,
    | 'disableRename'
    | 'disableDelete'
    | 'disableUploadLogo'
    | 'showLeave'
    | 'showUploadLogo'
    | 'showPin'
    | 'showRename'
  > {
  workspace?: Workspace | null
  workspaceCount: number
  sessionUserId?: string
}

/** Uses the same workspace role policy in the switcher and organization sidebar. */
export function WorkspaceContextMenu({
  workspace,
  workspaceCount,
  sessionUserId,
  ...props
}: WorkspaceContextMenuProps) {
  const canAdmin = workspace?.permissions === 'admin'
  const canLeave = Boolean(
    workspace && sessionUserId && sessionUserId !== workspace.ownerId && !workspace.isOrgAdmin
  )

  return (
    <ContextMenu
      {...props}
      showPin
      showRename
      showUploadLogo={Boolean(props.onUploadLogo)}
      showLeave={canLeave && Boolean(props.onLeave)}
      disableRename={!canAdmin}
      disableUploadLogo={!canAdmin}
      disableDelete={!canAdmin || workspaceCount <= 1}
    />
  )
}
