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
    // Wait until this workspace's metadata is loaded (activeWorkspace present) so
    // the workspace and organization groups always switch together. Acting during
    // the load window — when workspaceId is the new route value but organizationId
    // is still transiently null — would either strip a team workspace's org group
    // or pair the new workspace group with the previous workspace's org group.
    // Until then, events stay consistently attributed to the previous workspace.
    if (!workspaceId || !activeWorkspace) return
    if (organizationId) {
      posthog?.group('organization', organizationId)
    } else {
      // This workspace genuinely has no org — drop any organization group carried
      // over from a previously-active team workspace. resetGroups clears all
      // groups, so the workspace group is re-applied immediately below.
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
