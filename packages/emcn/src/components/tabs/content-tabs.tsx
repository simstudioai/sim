'use client'

import type { ReactNode } from 'react'
import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import { ControlRow } from '#emcn/components/button/control-row'
import { ScrollArea } from '#emcn/components/scroll-area/scroll-area'
import listStyles from '#emcn/components/tabs/tab-list.shared.module.css'
import styles from '#emcn/components/tabs/tabs.module.css'

interface ContentTabsProps {
  label: string
  items: readonly { id: string; label: string; content: ReactNode }[]
  current: string
  onSelect: (id: string) => void
  actions?: ReactNode
}

/** Controlled content destinations with linked panels and native tab keyboard navigation. */
export function ContentTabs({ label, items, current, onSelect, actions }: ContentTabsProps) {
  return (
    <BaseTabs.Root
      className={styles.contentRoot}
      value={current}
      onValueChange={(value) => {
        if (typeof value === 'string') onSelect(value)
      }}
    >
      <div className={styles.contentHeader}>
        <div className={styles.contentNavigation}>
          <ScrollArea label={label} axis='horizontal' arrows>
            <BaseTabs.List className={listStyles.lane} aria-label={label} activateOnFocus>
              {items.map((item) => (
                <ControlRow
                  key={item.id}
                  label={item.label}
                  render={<BaseTabs.Tab value={item.id} />}
                />
              ))}
            </BaseTabs.List>
          </ScrollArea>
        </div>
        {actions && <div className={styles.contentActions}>{actions}</div>}
      </div>
      {items.map((item) => (
        <BaseTabs.Panel key={item.id} value={item.id} className={styles.contentPane}>
          {item.content}
        </BaseTabs.Panel>
      ))}
    </BaseTabs.Root>
  )
}
