'use client'

import type { ReactNode } from 'react'
import { Skeleton } from '@sim/emcn'
import { BlockVisibilityLoader } from '@/app/workspace/[workspaceId]/providers/block-visibility-loader'
import { CustomBlocksLoader } from '@/app/workspace/[workspaceId]/providers/custom-blocks-loader'
import { ProviderModelsLoader } from '@/app/workspace/[workspaceId]/providers/provider-models-loader'
import { SettingsLoader } from '@/app/workspace/[workspaceId]/providers/settings-loader'
import {
  useOptionalWorkspaceHostContext,
  WorkspaceHostProvider,
} from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { WorkflowScopeSync } from '@/app/workspace/[workspaceId]/providers/workspace-scope-sync'
import { useWorkspaceHostContextQuery } from '@/hooks/queries/workspace-host'

interface ResourceWorkspaceHostProps {
  workspaceId: string
  organizationId?: string
  workflowId?: string
  isFileViewer?: boolean
  inline?: boolean
  children: ReactNode
}

/** Loads the selected resource's real host; organization chat never supplies a default workspace. */
export function ResourceWorkspaceHost(props: ResourceWorkspaceHostProps) {
  const current = useOptionalWorkspaceHostContext()
  if (
    current?.workspace.id === props.workspaceId &&
    (!props.organizationId || current.hostOrganizationId === props.organizationId)
  )
    return props.children
  return <LoadedResourceWorkspaceHost {...props} />
}

function LoadedResourceWorkspaceHost({
  workspaceId,
  organizationId,
  workflowId,
  isFileViewer,
  inline,
  children,
}: ResourceWorkspaceHostProps) {
  const { data, isPending, error } = useWorkspaceHostContextQuery(workspaceId)
  if (isPending)
    return inline ? (
      <span role='status'>Loading resource…</span>
    ) : (
      <Skeleton className='m-4 h-24 flex-1' />
    )
  if (
    error ||
    !data ||
    data.workspace.id !== workspaceId ||
    (organizationId && data.hostOrganizationId !== organizationId)
  ) {
    const Tag = inline ? 'span' : 'div'
    return (
      <Tag role='status' className='text-[var(--text-muted)] text-sm'>
        This resource is unavailable or you no longer have access.
      </Tag>
    )
  }
  return (
    <WorkspaceHostProvider workspaceId={workspaceId} initialContext={data}>
      <WorkspacePermissionsProvider
        workspaceId={workspaceId}
        workflowId={workflowId}
        isFileViewer={isFileViewer}
      >
        {workflowId ? (
          <WorkflowScopeSync workspaceId={workspaceId}>
            <SettingsLoader />
            <ProviderModelsLoader workspaceId={workspaceId} />
            <CustomBlocksLoader workspaceId={workspaceId} />
            <BlockVisibilityLoader workspaceId={workspaceId} />
            {children}
          </WorkflowScopeSync>
        ) : (
          children
        )}
      </WorkspacePermissionsProvider>
    </WorkspaceHostProvider>
  )
}
