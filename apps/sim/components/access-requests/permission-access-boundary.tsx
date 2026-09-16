'use client'

import type { ReactNode } from 'react'
import { Chip, ChipLink } from '@sim/emcn'
import { Lock } from '@sim/emcn/icons'
import { useParams, useRouter } from 'next/navigation'
import { RequestAccessAction } from '@/components/access-requests/request-access-action'
import { EmptyState } from '@/components/empty-state/empty-state'
import type { BooleanPermissionGroupConfigKey } from '@/lib/permission-groups/features'
import { useUserPermissionConfig } from '@/ee/access-control/hooks/permission-groups'
import { useDiscoverAccessRequests } from '@/hooks/queries/access-requests'

/** Safe feature metadata shared by navigation and access-required pages. */
export function useWorkspaceAccessRequestFeatures() {
  const params = useParams()
  const workspaceId = typeof params?.workspaceId === 'string' ? params.workspaceId : ''
  return useDiscoverAccessRequests(
    { kind: 'workspace', workspaceId, targetKind: 'feature', limit: 100, offset: 0 },
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
  if (!discovery.data.enabled) {
    return (
      children ?? (
        <EmptyState
          title='Access restricted'
          description='Your organization restricts this feature.'
        />
      )
    )
  }

  if (entry?.state === 'allowed') {
    return (
      <EmptyState
        title='Access updated'
        description='Refreshing your permissions...'
        action={<Chip onClick={() => void policy.refetch()}>Refresh access</Chip>}
      />
    )
  }
  if (!entry) {
    return (
      <EmptyState
        title='Access restricted'
        description='Your organization restricts this feature.'
      />
    )
  }

  return (
    <EmptyState
      title={`${entry.label} access required`}
      description={
        entry.reason ??
        'Your organization restricts this feature. You can ask an administrator for access.'
      }
      graphic={<Lock className='size-6 text-[var(--text-icon)]' aria-hidden />}
      action={
        <>
          {entry.state === 'requestable' && (
            <RequestAccessAction
              scope={{ kind: 'workspace', workspaceId }}
              target={entry.target}
              label={entry.label}
              pendingRequestId={entry.pendingRequestId}
            />
          )}
          <ChipLink href={`/workspace/${workspaceId}/access-requests`}>My requests</ChipLink>
        </>
      }
    />
  )
}
