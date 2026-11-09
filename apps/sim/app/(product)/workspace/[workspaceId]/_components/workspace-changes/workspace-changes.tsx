'use client'

import { ActivityRow } from '@sim/emcn/activity-row'
import { Icon } from '@sim/emcn/icon'
import { useSearchParams } from 'next/navigation'
import styles from '@/app/(product)/workspace/[workspaceId]/_components/workspace-changes/workspace-changes.module.css'
import { isAbsoluteHref, platformHref } from '@/platform/lib/navigation'
import type { WorkspaceChange } from '@/platform/shared/workspace-records'

interface WorkspaceChangesProps {
  title?: string
  changes: readonly WorkspaceChange[]
}

function changeGlyph(change: WorkspaceChange) {
  return change.providerId ? (
    <Icon providerId={change.providerId} />
  ) : (
    <Icon name={change.icon ?? 'I075'} />
  )
}

/** The workspace items a change touched; each one with a page links to it. */
export function WorkspaceChanges({ title = 'Workspace changes', changes }: WorkspaceChangesProps) {
  const search = useSearchParams()
  if (!changes.length) return null
  return (
    <section className={styles.changes} aria-label={title}>
      <h2 data-type='T093'>{title}</h2>
      <ul className={styles.rows}>
        {changes.map((change) => {
          const leading = changeGlyph(change)
          return change.href ? (
            <ActivityRow
              key={change.id}
              title={change.name}
              detail={change.type}
              leading={leading}
              href={isAbsoluteHref(change.href) ? change.href : platformHref(change.href, search)}
            />
          ) : (
            <ActivityRow
              key={change.id}
              title={change.name}
              detail={change.type}
              leading={leading}
              readOnly
            />
          )
        })}
      </ul>
    </section>
  )
}
