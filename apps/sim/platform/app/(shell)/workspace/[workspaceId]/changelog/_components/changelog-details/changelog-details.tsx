'use client'

import { Button } from '@sim/emcn/button'
import { PropertyList } from '@sim/emcn/property-list'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ControlBar } from '@/platform/app/(shell)/_components/control-bar/control-bar'
import {
  DetailHeading,
  DetailSplit,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/detail-split/detail-split'
import { WorkspaceChanges } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-changes/workspace-changes'
import type { ChangelogDetail } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import { useViewerTimeZone } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/workspace-session'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/changelog/_components/changelog-details/changelog-details.module.css'
import { platformHref } from '@/platform/lib/navigation'
import { workspacePath } from '@/platform/lib/workspace-navigation'
import { formatTimestamp } from '@/platform/shared/time'

interface ChangelogDetailsProps {
  entry: ChangelogDetail
  back: { href: string; label: string }
}

/** One shipped change: what it does and the workspace items it touched, beside who applied it. */
export function ChangelogDetails({ entry, back }: ChangelogDetailsProps) {
  const search = useSearchParams()
  const timeZone = useViewerTimeZone()
  const issueHref = platformHref(
    workspacePath(entry.workspace.id, `issues/${encodeURIComponent(entry.issueId)}`),
    search
  )
  return (
    <DetailSplit
      back={back}
      label='Change details'
      controls={
        <ControlBar>
          <Button variant='secondary' size='compact' render={<Link href={issueHref} />}>
            View issue
          </Button>
        </ControlBar>
      }
      facts={
        <PropertyList
          title='Facts'
          titleHidden
          properties={[
            { id: 'status', label: 'Status', kind: 'text', value: 'Merged' },
            {
              id: 'applied',
              label: 'Applied',
              kind: 'text',
              value: formatTimestamp(entry.appliedAt, timeZone),
            },
            {
              id: 'applied-by',
              label: 'Applied by',
              kind: 'person',
              value: entry.contributor.name,
              src: entry.contributor.src,
            },
            { id: 'issue', label: 'Issue', kind: 'link', value: entry.issueId, href: issueHref },
            {
              id: 'workspace',
              label: 'Workspace',
              kind: 'link',
              value: entry.workspace.name,
              href: platformHref(workspacePath(entry.workspace.id, 'dashboards'), search),
            },
          ]}
        />
      }
    >
      <DetailHeading title={entry.title} />
      <div className={styles.body}>
        {entry.body.map((paragraph) => (
          <p key={paragraph} data-type='T048'>
            {paragraph}
          </p>
        ))}
      </div>
      <WorkspaceChanges changes={entry.workspaceChanges} />
    </DetailSplit>
  )
}
