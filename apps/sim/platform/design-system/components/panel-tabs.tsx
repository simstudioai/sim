'use client'

import type { ReactNode } from 'react'
import { Tabs } from '@base-ui/react/tabs'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import { ActionMenu } from '@/platform/design-system/components/action-menu'
import { IconButton } from '@/platform/design-system/components/controls'
import { Icon } from '@/platform/design-system/components/icon'
import styles from '@/platform/design-system/components/panel-tabs.module.css'

interface PanelTabsProps {
  tabs: readonly { id: string; label: string; icon: IconName; content: ReactNode }[]
  current: string
  expanded: boolean
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onAdd: () => void
  onExpand: () => void
  onHide: () => void
}

export function PanelTabs({
  tabs,
  current,
  expanded,
  onSelect,
  onRemove,
  onAdd,
  onExpand,
  onHide,
}: PanelTabsProps) {
  const active = tabs.find((tab) => tab.id === current)
  return (
    <Tabs.Root
      className={styles.root}
      value={current}
      onValueChange={(value) => {
        if (typeof value === 'string') onSelect(value)
      }}
    >
      <header className={styles.header}>
        <div className={styles.strip}>
          <Tabs.List className={styles.tabs} aria-label='Chat panel tabs' activateOnFocus>
            {tabs.map((tab) => (
              <div className={styles.slot} key={tab.id}>
                <Tabs.Tab value={tab.id} className={styles.tab} data-type='T067'>
                  <Icon name={tab.icon} />
                  <span>{tab.label}</span>
                </Tabs.Tab>
                <div className={styles.close}>
                  <IconButton
                    icon='I105'
                    size='compact'
                    label={`Close ${tab.label} tab`}
                    onClick={() => onRemove(tab.id)}
                  />
                </div>
              </div>
            ))}
          </Tabs.List>
        </div>
        <span className={styles.title} data-type='T046'>
          {active?.label}
        </span>
        <IconButton icon='I074' label='New panel tab' onClick={onAdd} />
        <div className={styles.actions}>
          <div className={styles.expand}>
            <IconButton
              icon={expanded ? 'I053' : 'I060'}
              label={expanded ? 'Restore split panel' : 'Expand panel'}
              onClick={onExpand}
            />
          </div>
          <div className={styles.more}>
            <ActionMenu
              icon='I108'
              label='Panel tabs'
              actions={[
                ...tabs.map((tab) => ({
                  id: tab.id,
                  label: tab.label,
                  checked: tab.id === current,
                  onSelect: () => onSelect(tab.id),
                })),
                {
                  id: 'close',
                  label: 'Close current tab',
                  separatorBefore: true,
                  onSelect: () => onRemove(current),
                },
              ]}
            />
          </div>
          <IconButton icon='I038' label='Close chat panel' onClick={onHide} />
        </div>
      </header>
      {tabs.map((tab) => (
        <Tabs.Panel key={tab.id} value={tab.id} keepMounted className={styles.pane}>
          {tab.content}
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  )
}
