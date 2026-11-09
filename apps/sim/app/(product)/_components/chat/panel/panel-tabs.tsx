'use client'

import { IconButton } from '@sim/emcn/button'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { OverflowText } from '@sim/emcn/overflow-text'
import { type TabItem, Tabs } from '@sim/emcn/tabs'
import styles from '@/app/(product)/_components/chat/panel/panel-tabs.module.css'

interface PanelTabsProps {
  tabs: readonly TabItem[]
  current: string
  expanded: boolean
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  /** Absent when this surface has nothing to open a new tab with. */
  onAdd?: () => void
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
    <Tabs
      label='Chat panel tabs'
      tabs={tabs}
      current={current}
      onSelect={onSelect}
      onRemove={onRemove}
      renderHeader={(tabList) => (
        <header className={styles.header} data-expanded={expanded || undefined}>
          <div className={styles.tabList}>{tabList}</div>
          <span className={styles.title} data-type='T046'>
            {active && <OverflowText text={active.label}>{active.label}</OverflowText>}
          </span>
          {onAdd && <IconButton icon='I074' label='New panel tab' onClick={onAdd} />}
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
      )}
    />
  )
}
