'use client'

import type { ReactNode } from 'react'
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
  /** Moves a tab to an index in the strip; absent, the tabs keep their order. */
  onReorder?: (id: string, index: number) => void
  /** The current tab's own commands, before the panel's. */
  actions?: ReactNode
  /** What opens a new tab, after the strip; absent when this surface has nothing to open one with. */
  add?: ReactNode
  onExpand: () => void
  onHide: () => void
}

export function PanelTabs({
  tabs,
  current,
  expanded,
  onSelect,
  onRemove,
  onReorder,
  actions,
  add,
  onExpand,
  onHide,
}: PanelTabsProps) {
  const active = tabs.find((tab) => tab.id === current)
  const index = tabs.findIndex((tab) => tab.id === current)
  return (
    <Tabs
      label='Chat panel tabs'
      tabs={tabs}
      current={current}
      onSelect={onSelect}
      onRemove={onRemove}
      onReorder={onReorder}
      renderHeader={(tabList) => (
        <header className={styles.header} data-expanded={expanded || undefined}>
          <div className={styles.tabList}>{tabList}</div>
          <span className={styles.title} data-type='T046'>
            {active && <OverflowText text={active.label}>{active.label}</OverflowText>}
          </span>
          {add}
          <div className={styles.actions}>
            {actions}
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
                  ...(onReorder
                    ? [
                        {
                          id: 'move-left',
                          label: 'Move tab left',
                          separatorBefore: true,
                          disabled: index <= 0,
                          onSelect: () => onReorder(current, index - 1),
                        },
                        {
                          id: 'move-right',
                          label: 'Move tab right',
                          disabled: index < 0 || index >= tabs.length - 1,
                          onSelect: () => onReorder(current, index + 1),
                        },
                      ]
                    : []),
                  {
                    id: 'close',
                    label: 'Close current tab',
                    separatorBefore: !onReorder,
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
