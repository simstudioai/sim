'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import Link from 'next/link'
import { notFound, useSearchParams } from 'next/navigation'
import { DetailSplit } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/detail-split/detail-split'
import { ChangelogAccess } from '@/platform/app/(shell)/workspace/[workspaceId]/changelog/_components/changelog-access/changelog-access'
import { ChangelogDetails } from '@/platform/app/(shell)/workspace/[workspaceId]/changelog/_components/changelog-details/changelog-details'
import { ReleaseEdit } from '@/platform/app/(shell)/workspace/[workspaceId]/changelog/_components/release-edit/release-edit'
import { ReleaseNotes } from '@/platform/app/(shell)/workspace/[workspaceId]/changelog/_components/release-notes/release-notes'
import { useChangelogAccess, useLiveRelease } from '@/platform/lib/data/changelog'
import { useLiveWorkspace } from '@/platform/lib/data/workspace-summary'
import { platformHref } from '@/platform/lib/navigation'
import { workspacePath } from '@/platform/lib/workspace-navigation'

interface LiveReleaseProps {
  workspaceId: string
  releaseId: string
  back: { href: string; label: string }
}

/**
 * One release: its notes, change lines and the workflows it shipped. An editor can change its
 * title, version and reason here, and its notes in their file.
 */
export function LiveRelease({ workspaceId, releaseId, back }: LiveReleaseProps) {
  return (
    <ChangelogAccess workspaceId={workspaceId}>
      <Release workspaceId={workspaceId} releaseId={releaseId} back={back} />
    </ChangelogAccess>
  )
}

function Release({ workspaceId, releaseId, back }: LiveReleaseProps) {
  const search = useSearchParams()
  const [editing, setEditing] = useState(false)
  const access = useChangelogAccess(workspaceId)
  const workspace = useLiveWorkspace(workspaceId)
  const live = useLiveRelease(workspaceId, releaseId, workspace.workspace)
  if (workspace.missing || live.missing) notFound()
  if (!live.detail || !live.release)
    return (
      <DetailSplit read={live.read} back={back} label='Change details' railLabel='Facts'>
        {null}
      </DetailSplit>
    )
  const { release } = live
  return (
    <>
      <ChangelogDetails
        entry={live.detail}
        back={back}
        actions={
          access.canEdit && (
            <>
              <Button
                variant='secondary'
                size='compact'
                render={
                  <Link
                    href={platformHref(
                      workspacePath(workspaceId, `files/${encodeURIComponent(release.fileId)}`),
                      search
                    )}
                  />
                }
              >
                Edit notes
              </Button>
              <Button variant='secondary' size='compact' onClick={() => setEditing(true)}>
                Edit release
              </Button>
            </>
          )
        }
        notes={<ReleaseNotes workspaceId={workspaceId} fileId={release.fileId} />}
      />
      {editing && (
        <ReleaseEdit
          key={release.revision}
          workspaceId={workspaceId}
          release={release}
          open={editing}
          onOpenChange={setEditing}
        />
      )}
    </>
  )
}
