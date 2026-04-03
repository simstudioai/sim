'use client'

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

/**
 * Keeps workflow registry workspace scope synchronized with the current route.
 */
export function WorkspaceScopeSync() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const hydrationWorkspaceId = useWorkflowRegistry((state) => state.hydration.workspaceId)
  const switchToWorkspace = useWorkflowRegistry((state) => state.switchToWorkspace)
  const posthog = usePostHog()

  useEffect(() => {
    if (!workspaceId) return
    posthog?.group('workspace', workspaceId)
  }, [posthog, workspaceId])

  useEffect(() => {
    if (!workspaceId || hydrationWorkspaceId === workspaceId) {
      return
    }

    switchToWorkspace(workspaceId)
  }, [hydrationWorkspaceId, switchToWorkspace, workspaceId])

  return null
}
