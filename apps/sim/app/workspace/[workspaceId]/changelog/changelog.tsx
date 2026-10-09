'use client'

import { useState } from 'react'
import { Chip, cn, scrollFadeAttributes, scrollFadeClass, useScrollEdges } from '@sim/emcn'
import { Rss } from '@sim/emcn/icons'
import { EmptyState } from '@/components/empty-state/empty-state'
import type { ChangelogRelease } from '@/lib/api/contracts/changelog'
import {
  ReleaseDetailsModal,
  ReleaseEntry,
} from '@/app/workspace/[workspaceId]/changelog/components'
import ChangelogLoading from '@/app/workspace/[workspaceId]/changelog/loading'
import { Resource } from '@/app/workspace/[workspaceId]/components/resource/resource'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { PermissionAccessBoundary } from '@/ee/access-requests/components/permission-access-boundary'
import { useChangelogReleases } from '@/hooks/queries/changelog'

interface ChangelogProps {
  workspaceId: string
}

/** Every release Sim published in this workspace, newest first. */
export function Changelog({ workspaceId }: ChangelogProps) {
  return (
    <PermissionAccessBoundary configKey='hideFilesTab'>
      <ChangelogContent workspaceId={workspaceId} />
    </PermissionAccessBoundary>
  )
}

function ChangelogContent({ workspaceId }: ChangelogProps) {
  const canEdit = useUserPermissionsContext().canEdit === true
  const query = useChangelogReleases(workspaceId)
  const [editing, setEditing] = useState<ChangelogRelease | null>(null)
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const edges = useScrollEdges(scrollElement)

  if (query.isPending) return <ChangelogLoading />
  const releases = query.data?.pages.flatMap((page) => page.releases) ?? []

  return (
    <Resource>
      <Resource.Header icon={Rss} title='Changelog' />
      {query.error && !query.data ? (
        <div role='alert' className='flex flex-col items-center gap-3 p-6'>
          <p className='text-[var(--text-error)] text-small'>{query.error.message}</p>
          <Chip onClick={() => query.refetch()}>Retry</Chip>
        </div>
      ) : releases.length === 0 ? (
        <EmptyState
          title='Changelog'
          description='Sim publishes a release here when it ships changes to this workspace.'
        />
      ) : (
        <div
          ref={setScrollElement}
          className={cn(
            '@container/changelog min-h-0 flex-1 overflow-y-auto py-10',
            scrollFadeClass
          )}
          {...scrollFadeAttributes(edges)}
        >
          <div className='mx-auto flex max-w-[960px] flex-col gap-12 px-8'>
            {releases.map((release) => (
              <ReleaseEntry
                key={release.id}
                workspaceId={workspaceId}
                release={release}
                canEdit={canEdit}
                onEditDetails={setEditing}
              />
            ))}
            {query.hasNextPage && (
              <div className='flex flex-col gap-2'>
                <Chip onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
                  {query.isFetchingNextPage ? 'Loading...' : 'Show older releases'}
                </Chip>
                {query.isFetchNextPageError && (
                  <p role='alert' className='text-[var(--text-error)] text-small'>
                    {query.error?.message}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {editing && (
        <ReleaseDetailsModal
          key={editing.id}
          workspaceId={workspaceId}
          release={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Resource>
  )
}
