'use client'

import { ActivityRow } from '@sim/emcn/activity-row'
import { Icon } from '@sim/emcn/icon'
import { useSearchParams } from 'next/navigation'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-changes/workspace-changes.module.css'
import type { WorkspaceChange } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import { isAbsoluteHref, platformHref } from '@/platform/lib/navigation'

interface WorkspaceChangesProps {
  title?: string
  changes: readonly WorkspaceChange[]
}

/** The workspace items a change touched, each linking to where it lives. */
export function WorkspaceChanges({ title = 'Workspace changes', changes }: WorkspaceChangesProps) {
  const search = useSearchParams()
  if (!changes.length) return null
  return (
    <section className={styles.changes} aria-label={title}>
      <h2 data-type='T042'>{title}</h2>
      <ul className={styles.rows}>
        {changes.map((change) => (
          <ActivityRow
            key={change.id}
            title={change.name}
            detail={change.type}
            leading={
              change.providerId ? (
                <Icon providerId={change.providerId} />
              ) : (
                <Icon name={change.icon ?? 'I075'} />
              )
            }
            href={isAbsoluteHref(change.href) ? change.href : platformHref(change.href, search)}
          />
        ))}
      </ul>
    </section>
  )
}
