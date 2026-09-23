'use client'

import { type ReactNode, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { useWorkspacesWithMetadata } from '@/hooks/queries/workspace'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

/**
 * Keeps workflow registry workspace scope synchronized with the current route.
 */
export function WorkspaceScopeSync() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const posthog = usePostHog()
  const { data: workspaceData } = useWorkspacesWithMetadata()

  const activeWorkspace = workspaceData?.workspaces.find((ws) => ws.id === workspaceId)
  const workspaceName = activeWorkspace?.name
  const organizationId = activeWorkspace?.organizationId ?? null

  useEffect(() => {
    // Wait for metadata so the workspace and org groups switch together; acting
    // mid-load (organizationId transiently null) would mismatch or strip them.
    if (!workspaceId || !activeWorkspace) return
    if (organizationId) {
      posthog?.group('organization', organizationId)
    } else {
      // No org — clear any stale org group; resetGroups clears all, so the
      // workspace group is re-applied immediately below.
      posthog?.resetGroups()
    }
    posthog?.group('workspace', workspaceId, workspaceName ? { name: workspaceName } : undefined)
  }, [posthog, workspaceId, workspaceName, organizationId, activeWorkspace])

  return <WorkflowScopeSync workspaceId={workspaceId} />
}

/** Binds the single mounted workflow canvas to its explicit resource workspace. */
export function WorkflowScopeSync({
  workspaceId,
  children,
}: {
  workspaceId: string
  children?: ReactNode
}) {
  const hydrationWorkspaceId = useWorkflowRegistry((state) => state.hydration.workspaceId)
  const switchToWorkspace = useWorkflowRegistry((state) => state.switchToWorkspace)
  useEffect(() => {
    if (!workspaceId || useWorkflowRegistry.getState().hydration.workspaceId === workspaceId) {
      return
    }

    switchToWorkspace(workspaceId)
  }, [hydrationWorkspaceId, switchToWorkspace, workspaceId])

  return hydrationWorkspaceId === workspaceId ? children : null
}
