'use client'

import type { ReactNode } from 'react'
import { useOptionalWorkflowScope, WorkflowScopeProvider } from '@/platform/lib/data/workflows'

interface PreviewScopeProps {
  workspaceId?: string
  children: ReactNode
}

/**
 * Scopes preview sub-blocks to a workspace with no open workflow: the explicit prop, else the
 * enclosing editor's workspace.
 */
export function PreviewScope({ workspaceId, children }: PreviewScopeProps) {
  const enclosing = useOptionalWorkflowScope()
  const scopedWorkspaceId = workspaceId ?? enclosing?.workspaceId
  if (!scopedWorkspaceId) {
    throw new Error('Preview requires a workspaceId prop or an enclosing WorkflowScopeProvider')
  }
  return (
    <WorkflowScopeProvider workspaceId={scopedWorkspaceId} workflowId={null}>
      {children}
    </WorkflowScopeProvider>
  )
}
