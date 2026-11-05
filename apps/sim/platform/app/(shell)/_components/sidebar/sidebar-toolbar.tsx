'use client'

import { useRef } from 'react'
import { Inbox } from '@/platform/app/(shell)/_components/inbox/inbox'
import type { InboxItem } from '@/platform/app/(shell)/_components/model'
import styles from '@/platform/app/(shell)/_components/sidebar/sidebar.module.css'
import { IconButton, Tooltip } from '@/platform/design-system/components'

interface SidebarToolbarProps {
  items: readonly InboxItem[]
  navigate: (href: string) => void
  onSearch: () => void
  onCollapse: () => void
}
export function SidebarToolbar({ items, navigate, onSearch, onCollapse }: SidebarToolbarProps) {
  const toolbar = useRef<HTMLDivElement>(null)
  return (
    <div ref={toolbar} className={styles.actions}>
      <Tooltip label='Search (⌘K)'>
        <IconButton label='Search' icon='I089' onClick={onSearch} />
      </Tooltip>
      <Inbox anchor={toolbar} items={items} navigate={navigate} />
      <Tooltip label='Collapse sidebar'>
        <IconButton label='Collapse sidebar' icon='I066' onClick={onCollapse} />
      </Tooltip>
    </div>
  )
}
