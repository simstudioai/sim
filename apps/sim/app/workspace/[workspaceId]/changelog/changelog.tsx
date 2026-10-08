'use client'

import { useState } from 'react'
import { Chip } from '@sim/emcn'
import { EmptyState } from '@/components/empty-state/empty-state'
import type { ChangelogRelease } from '@/lib/api/contracts/changelog'
import {
  ReleaseDetailsModal,
  ReleaseEntry,
} from '@/app/workspace/[workspaceId]/changelog/components'
import ChangelogLoading from '@/app/workspace/[workspaceId]/changelog/loading'
import { Resource } from '@/app/workspace/[workspaceId]/components/resource/resource'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useChangelogReleases } from '@/hooks/queries/changelog'

interface ChangelogProps {
  workspaceId: string
}

/** Every release Sim published in this workspace, newest first. */
export function Changelog({ workspaceId }: ChangelogProps) {
  const canEdit = useUserPermissionsContext().canEdit === true
  const query = useChangelogReleases(workspaceId)
  const [editing, setEditing] = useState<ChangelogRelease | null>(null)

  if (query.isPending) return <ChangelogLoading />
  const releases = query.data?.pages.flatMap((page) => page.releases) ?? []

  return (
    <Resource>
      {query.error ? (
        <div className='p-6 text-[var(--text-error)]' role='alert'>
          {query.error.message}
        </div>
      ) : releases.length === 0 ? (
        <EmptyState
          title='Changelog'
          description='Sim publishes a release here when it ships changes to this workspace.'
        />
      ) : (
        <div className='@container/changelog min-h-0 flex-1 overflow-y-auto'>
          <div className='mx-auto flex max-w-[960px] flex-col gap-12 px-8 py-10'>
            <h1 className='text-2xl text-[var(--text-primary)] leading-tight tracking-[-0.02em]'>
              Changelog
            </h1>
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
              <div>
                <Chip onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
                  {query.isFetchingNextPage ? 'Loading...' : 'Show older releases'}
                </Chip>
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
