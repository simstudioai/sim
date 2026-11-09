'use client'

import { type RefObject, useState } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { Icon } from '@sim/emcn/icon'
import { AnchoredPopover } from '@sim/emcn/menu/anchored-popover'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import styles from '@/app/(product)/_components/inbox/inbox.module.css'
import type { InboxItem } from '@/app/(product)/_components/model'
import { useSidebarLayout } from '@/app/(product)/_components/sidebar/sidebar-layout'

interface InboxProps {
  anchor: RefObject<HTMLElement | null>
  items: readonly InboxItem[]
  navigate: (href: string) => void
}

const FILTERS = [
  { label: 'All', value: 'all' },
  { label: 'Unread', value: 'unread' },
]

export function Inbox({ anchor, items, navigate }: InboxProps) {
  const [open, setOpen] = useState(false)
  const { filter, setFilter, read, setRead } = useSidebarLayout()
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
        <ul className={styles.list}>
          {visible.map((item) => (
            <ActivityRow
              key={item.id}
              leading={<Icon name={item.icon} />}
              title={item.title}
              detail={item.description}
              onOpen={() => {
                setRead((previous) => new Set(previous).add(item.id))
                setOpen(false)
                navigate(item.href)
              }}
            />
          ))}
        </ul>
        {!visible.length && (
          <p className={styles.empty} data-type='T052'>
            {filter === 'unread' ? 'No unread notifications' : 'No notifications'}
          </p>
        )}
      </div>
    </AnchoredPopover>
  )
}
