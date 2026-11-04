'use client'

import { type RefObject, useState } from 'react'
import { Icon, SegmentedControl } from '@/platform/design-system/components'
import { AnchoredPopover } from '@/platform/design-system/components/anchored-popover'
import styles from '@/platform/design-system/features/shell/shell.module.css'
import type { InboxItem } from '@/platform/design-system/models/shell'

interface NotificationCenterProps {
  anchor: RefObject<HTMLElement | null>
  items: readonly InboxItem[]
  navigate: (href: string) => void
}

const FILTERS = [
  { label: 'All', value: 'all' },
  { label: 'Unread', value: 'unread' },
]

export function NotificationCenter({ anchor, items, navigate }: NotificationCenterProps) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('all')
  const [read, setRead] = useState<ReadonlySet<string>>(new Set())
  const visible = items.filter((item) => filter === 'all' || (item.unread && !read.has(item.id)))
  return (
    <AnchoredPopover
      presentation='panel'
      anchor={anchor}
      label='Notifications'
      open={open}
      onOpenChange={setOpen}
      icon='I106'
    >
      <div className={styles.inbox}>
        <header className={styles.inboxHeader}>
          <h2 data-type='T093'>Inbox</h2>
          <SegmentedControl
            label='Inbox filter'
            defaultValue={filter}
            options={FILTERS}
            onSelect={setFilter}
          />
        </header>
        {visible.map((item) => (
          <button
            key={item.id}
            type='button'
            className={styles.inboxRow}
            onClick={() => {
              setRead((previous) => new Set(previous).add(item.id))
              setOpen(false)
              navigate(item.href)
            }}
          >
            <span className={styles.inboxIcon}>
              <Icon name={item.icon} />
            </span>
            <span className={styles.copy}>
              <span data-type='T059'>{item.title}</span>
              <span data-type='T050'>{item.description}</span>
            </span>
            <Icon name='I032' />
          </button>
        ))}
        {!visible.length && (
          <p className={styles.empty} data-type='T052'>
            {filter === 'unread' ? 'No unread notifications' : 'No notifications'}
          </p>
        )}
      </div>
    </AnchoredPopover>
  )
}
