'use client'

import type { ReactNode } from 'react'
import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import { ControlRow } from '@/platform/design-system/components/button/control-row'
import { ScrollArea } from '@/platform/design-system/components/scroll-area/scroll-area'
import listStyles from '@/platform/design-system/components/tabs/tab-list.shared.module.css'
import styles from '@/platform/design-system/components/tabs/tabs.module.css'

interface ContentTabsProps {
  label: string
  items: readonly { id: string; label: string; content: ReactNode }[]
  current: string
  onSelect: (id: string) => void
}

/** Controlled content destinations with linked panels and native tab keyboard navigation. */
export function ContentTabs({ label, items, current, onSelect }: ContentTabsProps) {
  return (
    <BaseTabs.Root
      className={styles.contentRoot}
      value={current}
      onValueChange={(value) => {
        if (typeof value === 'string') onSelect(value)
      }}
    >
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
      {items.map((item) => (
        <BaseTabs.Panel key={item.id} value={item.id} className={styles.contentPane}>
          {item.content}
        </BaseTabs.Panel>
      ))}
    </BaseTabs.Root>
  )
}
