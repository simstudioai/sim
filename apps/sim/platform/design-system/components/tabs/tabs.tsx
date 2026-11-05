'use client'

import { type ReactNode, useRef } from 'react'
import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import { IconButton } from '@/platform/design-system/components/button/button'
import { ControlRow } from '@/platform/design-system/components/button/control-row'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'
import styles from '@/platform/design-system/components/tabs/tabs.module.css'

export interface TabItem {
  id: string
  label: string
  icon: IconName
  content: ReactNode
}

interface TabsProps {
  label: string
  tabs: readonly TabItem[]
  current: string
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  renderHeader: (tabList: ReactNode) => ReactNode
}

export function Tabs({ label, tabs, current, onSelect, onRemove, renderHeader }: TabsProps) {
  const scrollRef = useScrollEdges<HTMLDivElement>('horizontal')
  const selected = useRef<HTMLButtonElement>(null)
  function closeTab(id: string) {
    onRemove(id)
    if (tabs.length > 1) requestAnimationFrame(() => selected.current?.focus())
  }
  return (
    <BaseTabs.Root
      className={styles.root}
      value={current}
      onValueChange={(value) => {
        if (typeof value === 'string') onSelect(value)
      }}
    >
      {renderHeader(
        <div ref={scrollRef} className={styles.strip}>
          <BaseTabs.List className={styles.tabs} aria-label={label} activateOnFocus>
            {tabs.map((tab) => (
              <ControlRow
                key={tab.id}
                label={tab.label}
                icon={tab.icon}
                render={
                  <BaseTabs.Tab
                    value={tab.id}
                    ref={tab.id === current ? selected : undefined}
                    onKeyDown={(event) => {
                      if (event.key === 'Delete') {
                        event.preventDefault()
                        closeTab(tab.id)
                      }
                    }}
                  />
                }
                action={
                  <IconButton
                    icon='I105'
                    size='compact'
                    label={`Close ${tab.label} tab`}
                    onClick={() => closeTab(tab.id)}
                  />
                }
              />
            ))}
          </BaseTabs.List>
        </div>
      )}
      {tabs.map((tab) => (
        <BaseTabs.Panel key={tab.id} value={tab.id} keepMounted className={styles.pane}>
          {tab.content}
        </BaseTabs.Panel>
      ))}
    </BaseTabs.Root>
  )
}
