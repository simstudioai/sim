'use client'

import type { ReactNode } from 'react'
import { Button } from '@sim/emcn/button'
import { PropertyList } from '@sim/emcn/property-list'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { DirectoryHeading } from '@/platform/app/(shell)/_components/resource-directory/resource-directory'
import {
  DetailSection,
  DetailSplit,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/detail-split/detail-split'
import { WorkspaceChanges } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-changes/workspace-changes'
import type { WorkspaceRead } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import { useViewerTimeZone } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/workspace-session'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/changelog/_components/changelog-details/changelog-details.module.css'
import { platformHref } from '@/platform/lib/navigation'
import { workspacePath } from '@/platform/lib/workspace-navigation'
import { formatTimestamp } from '@/platform/shared/time'
import type { ChangelogDetail } from '@/platform/shared/workspace-records'

interface ChangelogDetailsProps {
  /** How the page's read stands; ready when omitted. */
  read?: WorkspaceRead
  entry: ChangelogDetail
  back: { href: string; label: string }
  /** Commands on the change, such as editing a release, after View issue. */
  actions?: ReactNode
  /** The change's own notes, after its description. */
  notes?: ReactNode
}

/** One shipped change: what it does and the workspace items it touched, beside who applied it. */
export function ChangelogDetails({ entry, back, read, actions, notes }: ChangelogDetailsProps) {
  const search = useSearchParams()
  const timeZone = useViewerTimeZone()
  const issueHref =
    entry.issueId &&
    platformHref(
      workspacePath(entry.workspace.id, `issues/${encodeURIComponent(entry.issueId)}`),
      search
    )
  return (
    <DetailSplit
      read={read}
      back={back}
      label='Change details'
      actions={
        (issueHref || actions) && (
          <>
            {issueHref && (
              <Button variant='secondary' size='compact' render={<Link href={issueHref} />}>
                View issue
              </Button>
            )}
            {actions}
          </>
        )
      }
      railLabel='Facts'
      rail={
        <PropertyList
          title='Facts'
          titleHidden
          properties={[
            ...(issueHref
              ? [{ id: 'status', label: 'Status', kind: 'text' as const, value: 'Merged' }]
              : []),
            ...(entry.version
              ? [{ id: 'version', label: 'Version', kind: 'text' as const, value: entry.version }]
              : []),
            {
              id: 'applied',
              label: 'Applied',
              kind: 'text',
              value: formatTimestamp(entry.appliedAt, timeZone),
            },
            ...(entry.contributor
              ? [
                  {
                    id: 'applied-by',
                    label: 'Applied by',
                    kind: 'person' as const,
                    value: entry.contributor.name,
                    src: entry.contributor.src,
                  },
                ]
              : []),
            ...(entry.issueId && issueHref
              ? [
                  {
                    id: 'issue',
                    label: 'Issue',
                    kind: 'link' as const,
                    value: entry.issueId,
                    href: issueHref,
                  },
                ]
              : []),
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
      <DirectoryHeading title={entry.title} description={entry.description} />
      {entry.body.length > 0 && (
        <div className={styles.body}>
          {entry.body.map((paragraph) => (
            <p key={paragraph} data-type='T048'>
              {paragraph}
            </p>
          ))}
        </div>
      )}
      {notes}
      {entry.changes && entry.changes.length > 0 && (
        <DetailSection title='Changes'>
          <ul className={styles.changes}>
            {entry.changes.map((change) => (
              <li key={change.id} data-type='T048'>
                {change.href ? (
                  <Link href={platformHref(change.href, search)} className={styles.change}>
                    {change.text}
                  </Link>
                ) : (
                  change.text
                )}
              </li>
            ))}
          </ul>
        </DetailSection>
      )}
      <WorkspaceChanges changes={entry.workspaceChanges} />
    </DetailSplit>
  )
}
