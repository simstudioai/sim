'use client'

import type { ReactNode } from 'react'
import { SettingsNavigationProvider } from '@/components/settings/settings-navigation-provider'
import { BlockVisibilityLoader } from '@/components/workspace-providers/block-visibility-loader'
import { ProviderModelsLoader } from '@/components/workspace-providers/provider-models-loader'
import { SettingsLoader } from '@/components/workspace-providers/settings-loader'
import { WorkspacePermissionsProvider } from '@/components/workspace-providers/workspace-permissions-provider'
import { WorkflowScopeSync } from '@/components/workspace-providers/workspace-scope-sync'
import { connectWorkflowStores } from '@/stores/workflows/state-port/connect-stores'

// The socket provider and chat read workflow state through its port; from here on, the real stores.
connectWorkflowStores()

interface WorkflowWorkspaceProvidersProps {
  workspaceId: string
  children: ReactNode
}

/**
 * What the legacy workspace layout mounts for its workflow editor, for the Workflows tab only:
 * workspace permissions, the registry bound to this workspace and the settings, model and
 * block-visibility loaders. The realtime socket is the workspace layout's shared provider. Custom
 * blocks hydrate from the route, which owns their tile artwork. The permissions provider reads the
 * workflow id from the route. Workspace Settings sections exist only in the legacy app, so the
 * editor's "open settings" links (secrets, billing, credentials, MCP) open there in a new tab, as the
 * legacy provider's `_blank` target does.
 */
export function WorkflowWorkspaceProviders({
  workspaceId,
  children,
}: WorkflowWorkspaceProvidersProps) {
  return (
    <>
      <SettingsLoader />
      <ProviderModelsLoader workspaceId={workspaceId} />
      <BlockVisibilityLoader workspaceId={workspaceId} />
      <WorkspacePermissionsProvider>
        <SettingsNavigationProvider navigationTarget='_blank'>
          <WorkflowScopeSync workspaceId={workspaceId}>{children}</WorkflowScopeSync>
        </SettingsNavigationProvider>
      </WorkspacePermissionsProvider>
    </>
  )
}
