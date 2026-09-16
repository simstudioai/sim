'use client'

import type { ReactNode } from 'react'
import { Chip } from '@sim/emcn'
import { useParams, useRouter } from 'next/navigation'
import { RequestAccessAction } from '@/components/access-requests/request-access-action'
import { EmptyState } from '@/components/empty-state/empty-state'
import type { BooleanPermissionGroupConfigKey } from '@/lib/permission-groups/features'
import { FilesEmptyState } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/files-empty-state'
import { KnowledgeEmptyState } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/knowledge-empty-state'
import { TablesEmptyState } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/tables-empty-state'
import { useUserPermissionConfig } from '@/ee/access-control/hooks/permission-groups'
import { useDiscoverAccessRequests } from '@/hooks/queries/access-requests'
import { workspaceFeatureDiscoveryQuery } from '@/hooks/queries/utils/access-request-keys'

/** Safe feature metadata shared by navigation and access-required pages. */
export function useWorkspaceAccessRequestFeatures() {
  const params = useParams()
  const workspaceId = typeof params?.workspaceId === 'string' ? params.workspaceId : ''
  return useDiscoverAccessRequests(
    workspaceFeatureDiscoveryQuery(workspaceId),
    Boolean(workspaceId)
  )
}

interface PermissionAccessBoundaryProps {
  configKey: BooleanPermissionGroupConfigKey
  children?: ReactNode
}

/** Omit children on a server-denied page to keep protected content behind a fresh server check. */
export function PermissionAccessBoundary({ configKey, children }: PermissionAccessBoundaryProps) {
  const params = useParams()
  const router = useRouter()
  const workspaceId = typeof params?.workspaceId === 'string' ? params.workspaceId : ''
  const policy = useUserPermissionConfig(workspaceId)
  const discovery = useWorkspaceAccessRequestFeatures()
  const blocked = policy.data?.config?.[configKey] === true
  const entry = discovery.data?.entries.find(
    (candidate) => candidate.target.kind === 'feature' && candidate.target.configKey === configKey
  )
  const ResourceEmptyState =
    configKey === 'hideTablesTab'
      ? TablesEmptyState
      : configKey === 'hideKnowledgeBaseTab'
        ? KnowledgeEmptyState
        : configKey === 'hideFilesTab'
          ? FilesEmptyState
          : EmptyState

  if (policy.isPending) {
    return (
      <EmptyState title='Checking access' description='Loading your organization access policy.' />
    )
  }
  if (policy.isError) {
    return (
      <EmptyState
        title='Unable to check access'
        description={policy.error.message}
        action={<Chip onClick={() => void policy.refetch()}>Try again</Chip>}
      />
    )
  }
  if (!blocked) {
    return (
      children ?? (
        <EmptyState
          title='Access updated'
          description='Reload to open this page.'
          action={<Chip onClick={() => router.refresh()}>Reload page</Chip>}
        />
      )
    )
  }
  if (discovery.isPending) {
    return (
      <EmptyState title='Checking access' description='Loading your organization access policy.' />
    )
  }
  if (discovery.isError) {
    return (
      <EmptyState
        title='Unable to check access'
        description={discovery.error.message}
        action={<Chip onClick={() => void discovery.refetch()}>Try again</Chip>}
      />
    )
  }
  if (!discovery.data.enabled && children) return children

  if (entry?.state === 'allowed') {
    return (
      <EmptyState
        title='Access updated'
        description={
          policy.isFetching
            ? 'Refreshing your permissions...'
            : 'Refresh to load your latest permissions.'
        }
        action={<Chip onClick={() => void policy.refetch()}>Refresh access</Chip>}
      />
    )
  }
  return (
    <ResourceEmptyState
      title='Access required'
      description={
        discovery.data.enabled && entry?.state === 'requestable'
          ? entry.pendingRequestId
            ? 'Your request is pending.'
            : 'Ask an administrator for access.'
          : (entry?.reason ?? 'Your organization restricts this feature.')
      }
      action={
        discovery.data.enabled && entry?.state === 'requestable' ? (
          <RequestAccessAction
            scope={{ kind: 'workspace', workspaceId }}
            target={entry.target}
            label={entry.label}
            pendingRequestId={entry.pendingRequestId}
            variant='primary'
          />
        ) : undefined
      }
    />
  )
}
