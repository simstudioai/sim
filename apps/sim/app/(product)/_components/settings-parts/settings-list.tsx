'use client'

import type { ReactNode } from 'react'
import { EmptyState } from '@sim/emcn/empty-state'
import { SettingsSection } from '@sim/emcn/settings-section'
import { PageOverflow } from '@sim/emcn-platform/page-column'
import styles from '@/app/(product)/_components/settings-parts/settings-parts.module.css'

interface SettingsEmpty {
  title: string
  description?: string
  /** A way forward, such as Clear search; none when the page's toolbar already creates. */
  action?: ReactNode
}

interface SettingsListProps {
  title: string
  /** Set when the list has no rows: the section shows this empty state in place of its surface. */
  empty?: SettingsEmpty
  children?: ReactNode
}

/**
 * A titled settings section whose rows may run out. With rows it is a `SettingsSection`; empty, the
 * `EmptyState` takes the surface's place under the same title, bled by `PageOverflow` so its text
 * keeps the column's edge. An `EmptyState` never sits inside a surface, where its own inset would
 * set it 8px inside the rows' text.
 */
export function SettingsList({ title, empty, children }: SettingsListProps) {
  if (!empty) return <SettingsSection title={title}>{children}</SettingsSection>
  return (
    <section className={styles.listSection} aria-label={title} data-setting-label={title}>
      <h2 data-type='T093'>{title}</h2>
      <PageOverflow>
        <EmptyState title={empty.title} description={empty.description} action={empty.action} />
      </PageOverflow>
    </section>
  )
}
