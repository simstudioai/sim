'use client'

import { createContext, type ReactNode, useContext, useMemo } from 'react'

interface WorkflowScope {
  workspaceId: string
  /** Null in read-only previews, which render editor sub-blocks outside an open workflow. */
  workflowId: string | null
}

const WorkflowScopeContext = createContext<WorkflowScope | null>(null)

interface WorkflowScopeProviderProps extends WorkflowScope {
  children: ReactNode
}

/**
 * Supplies the workspace and workflow ids to the editor tree, so the editor
 * works wherever it is mounted instead of reading them from the route.
 */
export function WorkflowScopeProvider({
  workspaceId,
  workflowId,
  children,
}: WorkflowScopeProviderProps) {
  if (!workspaceId) {
    throw new Error('WorkflowScopeProvider requires a workspaceId')
  }
  const value = useMemo(() => ({ workspaceId, workflowId }), [workspaceId, workflowId])
  return <WorkflowScopeContext.Provider value={value}>{children}</WorkflowScopeContext.Provider>
}

/** Returns the enclosing scope, or null outside a WorkflowScopeProvider. */
export function useOptionalWorkflowScope(): WorkflowScope | null {
  return useContext(WorkflowScopeContext)
}

/**
 * Returns the editor's workspace and workflow ids. `workflowId` is null in previews.
 * Throws outside a WorkflowScopeProvider.
 */
export function useWorkflowScope(): WorkflowScope {
  const scope = useOptionalWorkflowScope()
  if (!scope) {
    throw new Error('useWorkflowScope must be used within a WorkflowScopeProvider')
  }
  return scope
}

/** For editor-only components: throws in a preview scope, which has no workflow. */
export function useScopedWorkflowId(): string {
  const { workflowId } = useWorkflowScope()
  if (!workflowId) {
    throw new Error('useScopedWorkflowId must be used within an editor workflow scope')
  }
  return workflowId
}
