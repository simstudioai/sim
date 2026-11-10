'use client'

import { useRef } from 'react'
import { IconButton } from '@sim/emcn/button'
import { Tooltip } from '@sim/emcn/tooltip'
import { Inbox } from '@/app/(product)/_components/inbox/inbox'
import styles from '@/app/(product)/_components/sidebar/sidebar.module.css'
import type { InboxItem } from '@/platform/lib/data/models/shell'

interface SidebarToolbarProps {
  items: readonly InboxItem[]
  showInbox: boolean
  navigate: (href: string) => void
  onSearch: () => void
  onCollapse: () => void
}
export function SidebarToolbar({
  items,
  showInbox,
  navigate,
  onSearch,
  onCollapse,
}: SidebarToolbarProps) {
  const toolbar = useRef<HTMLDivElement>(null)
  return (
    <div ref={toolbar} className={styles.actions}>
      <Tooltip label='Search (⌘K)'>
        <IconButton size='row' label='Search' icon='I089' onClick={onSearch} />
      </Tooltip>
      {showInbox && <Inbox anchor={toolbar} items={items} navigate={navigate} />}
      <Tooltip label='Collapse sidebar'>
        <IconButton size='row' label='Collapse sidebar' icon='I066' onClick={onCollapse} />
      </Tooltip>
    </div>
  )
}
