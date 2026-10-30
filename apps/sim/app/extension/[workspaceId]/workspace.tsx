'use client'

import { Chip, ChipLink } from '@sim/emcn'
import { isApiClientError } from '@/lib/api/client/errors'
import { ExtensionChat } from '@/app/extension/[workspaceId]/chat'
import ExtensionLoading from '@/app/extension/loading'
import { ExtensionSignIn } from '@/app/extension/sign-in'
import { BlockVisibilityLoader } from '@/app/workspace/[workspaceId]/providers/block-visibility-loader'
import { CustomBlocksLoader } from '@/app/workspace/[workspaceId]/providers/custom-blocks-loader'
import { ProviderModelsLoader } from '@/app/workspace/[workspaceId]/providers/provider-models-loader'
import { SettingsLoader } from '@/app/workspace/[workspaceId]/providers/settings-loader'
import { WorkspaceHostProvider } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { WorkspaceScopeSync } from '@/app/workspace/[workspaceId]/providers/workspace-scope-sync'
import { PermissionAccessBoundary } from '@/ee/access-requests/components/permission-access-boundary'
import { BrandingProvider } from '@/ee/whitelabeling/components/branding-provider'
import { useWorkspaceHostContextQuery } from '@/hooks/queries/workspace-host'

interface ExtensionWorkspaceProps {
  workspaceId: string
}

export function ExtensionWorkspace({ workspaceId }: ExtensionWorkspaceProps) {
  const { data, isPending, error, refetch } = useWorkspaceHostContextQuery(workspaceId)
  if (isApiClientError(error) && error.status === 401) return <ExtensionSignIn />
  if (isPending) return <ExtensionLoading />
  const accessDenied = isApiClientError(error) && (error.status === 403 || error.status === 404)
  if (accessDenied || !data) {
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
          <PermissionAccessBoundary configKey='hideCopilot'>
            <ExtensionChat workspaceId={workspaceId} workspaceName={data.workspace.name} />
          </PermissionAccessBoundary>
        </WorkspacePermissionsProvider>
      </BrandingProvider>
    </WorkspaceHostProvider>
  )
}
