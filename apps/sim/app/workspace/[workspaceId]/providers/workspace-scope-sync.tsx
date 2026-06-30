'use client'

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { useWorkspacesWithMetadata } from '@/hooks/queries/workspace'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

/**
 * Keeps workflow registry workspace scope synchronized with the current route.
 */
export function WorkspaceScopeSync() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const hydrationWorkspaceId = useWorkflowRegistry((state) => state.hydration.workspaceId)
  const switchToWorkspace = useWorkflowRegistry((state) => state.switchToWorkspace)
  const posthog = usePostHog()
  const { data: workspaceData } = useWorkspacesWithMetadata()

  const activeWorkspace = workspaceData?.workspaces.find((ws) => ws.id === workspaceId)
  const workspaceName = activeWorkspace?.name
  const organizationId = activeWorkspace?.organizationId ?? null

  useEffect(() => {
    if (!workspaceId) return
    if (organizationId) {
      posthog?.group('organization', organizationId)
    } else if (activeWorkspace) {
      // Metadata is loaded and this workspace genuinely has no org — drop any
      // organization group carried over from a previously-active team workspace.
      // While metadata is still loading, activeWorkspace is undefined and
      // organizationId is transiently null, so resetting here would briefly strip
      // a team workspace's org group. resetGroups clears all groups, so the
      // workspace group is re-applied immediately below.
      posthog?.resetGroups()
    }
    posthog?.group('workspace', workspaceId, workspaceName ? { name: workspaceName } : undefined)
  }, [posthog, workspaceId, workspaceName, organizationId, activeWorkspace])

  useEffect(() => {
    if (!workspaceId || hydrationWorkspaceId === workspaceId) {
      return
    }

    switchToWorkspace(workspaceId)
  }, [hydrationWorkspaceId, switchToWorkspace, workspaceId])

  return null
}
