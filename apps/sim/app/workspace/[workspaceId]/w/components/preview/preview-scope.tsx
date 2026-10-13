'use client'

import type { ReactNode } from 'react'
import { WorkflowScopeProvider } from '@/app/workspace/[workspaceId]/providers/workflow-scope-provider'
import { useOptionalWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'

interface PreviewScopeProps {
  workspaceId?: string
  children: ReactNode
}

/** Scopes preview sub-blocks to a workspace with no open workflow. */
export function PreviewScope({ workspaceId, children }: PreviewScopeProps) {
  const host = useOptionalWorkspaceHostContext()
  const scopedWorkspaceId = workspaceId ?? host?.workspace.id
  if (!scopedWorkspaceId) {
    throw new Error('Preview requires a workspaceId prop or a WorkspaceHostProvider')
  }
  return (
    <WorkflowScopeProvider workspaceId={scopedWorkspaceId} workflowId={null}>
      {children}
    </WorkflowScopeProvider>
  )
}
