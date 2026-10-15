'use client'

import type { ReactNode } from 'react'
import {
  useOptionalWorkflowScope,
  WorkflowScopeProvider,
} from '@/app/workspace/[workspaceId]/providers/workflow-scope-provider'
import { useOptionalWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'

interface PreviewScopeProps {
  workspaceId?: string
  children: ReactNode
}

/**
 * Scopes preview sub-blocks to a workspace with no open workflow: the explicit prop, else the
 * enclosing editor's workspace, else the workspace host.
 */
export function PreviewScope({ workspaceId, children }: PreviewScopeProps) {
  const enclosing = useOptionalWorkflowScope()
  const host = useOptionalWorkspaceHostContext()
  const scopedWorkspaceId = workspaceId ?? enclosing?.workspaceId ?? host?.workspace.id
  if (!scopedWorkspaceId) {
    throw new Error(
      'Preview requires a workspaceId prop, an enclosing WorkflowScopeProvider, or a WorkspaceHostProvider'
    )
  }
  return (
    <WorkflowScopeProvider workspaceId={scopedWorkspaceId} workflowId={null}>
      {children}
    </WorkflowScopeProvider>
  )
}
