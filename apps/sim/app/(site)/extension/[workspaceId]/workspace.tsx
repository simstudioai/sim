'use client'

import { Chip, ChipLink } from '@sim/emcn-legacy'
import { ChatPlanModal } from '@/components/mothership-chat/chat-plan-modal'
import { BlockVisibilityLoader } from '@/components/workspace-providers/block-visibility-loader'
import { CustomBlocksLoader } from '@/components/workspace-providers/custom-blocks-loader'
import { ProviderModelsLoader } from '@/components/workspace-providers/provider-models-loader'
import { SettingsLoader } from '@/components/workspace-providers/settings-loader'
import { WorkspaceHostProvider } from '@/components/workspace-providers/workspace-host-provider'
import { WorkspacePermissionsProvider } from '@/components/workspace-providers/workspace-permissions-provider'
import { WorkspaceScopeSync } from '@/components/workspace-providers/workspace-scope-sync'
import { isApiClientError } from '@/lib/api/client/errors'
import { ExtensionChat } from '@/app/(site)/extension/[workspaceId]/chat'
import ExtensionLoading from '@/app/(site)/extension/loading'
import { ExtensionSessionExpired } from '@/app/(site)/extension/providers'
import { PermissionAccessBoundary } from '@/ee/access-requests/components/permission-access-boundary'
import { BrandingProvider } from '@/ee/whitelabeling/components/branding-provider'
import {
  useWorkspaceHostContextQuery,
  WORKSPACE_HOST_CONTEXT_STALE_TIME,
} from '@/hooks/queries/workspace-host'
import { connectWorkflowStores } from '@/stores/workflows/state-port/connect-stores'

// The extension chat reads and runs workflows through the workflow state port.
connectWorkflowStores()

interface ExtensionWorkspaceProps {
  workspaceId: string
  /** The organization the workspace's pages open in, or `null` when the viewer cannot open it. */
  organizationId: string | null
}

export function ExtensionWorkspace({ workspaceId, organizationId }: ExtensionWorkspaceProps) {
  const { data, isPending, error, refetch } = useWorkspaceHostContextQuery(workspaceId, {
    refetchInterval: WORKSPACE_HOST_CONTEXT_STALE_TIME,
    refetchOnWindowFocus: true,
  })
  if (isApiClientError(error) && error.status === 401) return <ExtensionSessionExpired />
  if (isPending) return <ExtensionLoading />
  const accessDenied = isApiClientError(error) && (error.status === 403 || error.status === 404)
  if (accessDenied || !data || !organizationId) {
    return (
      <main className='flex h-dvh flex-col items-center justify-center gap-4 bg-[var(--bg)] p-6 text-[var(--text-body)] text-small'>
        <p>This workspace is unavailable.</p>
        <Chip onClick={() => void refetch()}>Retry</Chip>
        <ChipLink href='/extension'>Choose another workspace</ChipLink>
      </main>
    )
  }
  if (data.deployment?.chatEnabled === false) {
    return (
      <main className='flex h-dvh items-center justify-center bg-[var(--bg)] p-6 text-[var(--text-muted)] text-small'>
        Chat is not enabled for this Sim deployment.
      </main>
    )
  }
  return (
    <WorkspaceHostProvider workspaceId={workspaceId} initialContext={data}>
      <BrandingProvider
        hostOrganizationId={data.hostOrganizationId}
        viewerIsHostOrganizationMember={data.viewer.isHostOrganizationMember}
      >
        <WorkspacePermissionsProvider workspaceId={workspaceId}>
          <SettingsLoader />
          <ProviderModelsLoader workspaceId={workspaceId} />
          <CustomBlocksLoader />
          <BlockVisibilityLoader workspaceId={workspaceId} />
          <WorkspaceScopeSync />
          <PermissionAccessBoundary
            configKey='hideCopilot'
            navigationAction={<ChipLink href='/extension'>Back to chat</ChipLink>}
          >
            <ExtensionChat
              workspaceId={workspaceId}
              organizationId={organizationId}
              workspaceName={data.workspace.name}
            />
          </PermissionAccessBoundary>
          <ChatPlanModal />
        </WorkspacePermissionsProvider>
      </BrandingProvider>
    </WorkspaceHostProvider>
  )
}
