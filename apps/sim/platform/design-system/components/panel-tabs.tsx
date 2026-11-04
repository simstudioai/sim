'use client'

import { type ReactNode, useRef } from 'react'
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
  const selected = useRef<HTMLButtonElement>(null)
  function closeTab(id: string) {
    onRemove(id)
    if (tabs.length > 1) requestAnimationFrame(() => selected.current?.focus())
  }
  return (
    <Tabs.Root
      className={styles.root}
      value={current}
      onValueChange={(value) => {
        if (typeof value === 'string') onSelect(value)
      }}
    >
      <header className={styles.header} data-expanded={expanded || undefined}>
        <div className={styles.strip}>
          <Tabs.List className={styles.tabs} aria-label='Chat panel tabs' activateOnFocus>
            {tabs.map((tab) => (
              <Tabs.Tab
                key={tab.id}
                value={tab.id}
                ref={tab.id === current ? selected : undefined}
                className={styles.tab}
                data-type='T067'
                onKeyDown={(event) => {
                  if (event.key === 'Delete') {
                    event.preventDefault()
                    closeTab(tab.id)
                  }
                }}
              >
                <Icon name={tab.icon} />
                <span>{tab.label}</span>
              </Tabs.Tab>
            ))}
          </Tabs.List>
          <div className={styles.closes}>
            {tabs.map((tab) => (
              <div className={styles.slot} key={tab.id}>
                <IconButton
                  icon='I105'
                  size='compact'
                  label={`Close ${tab.label} tab`}
                  onClick={() => closeTab(tab.id)}
                />
              </div>
            ))}
          </div>
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
