'use client'

import type { ReactNode } from 'react'
import { Chip } from '@sim/emcn/button'
import { Disclosure } from '@sim/emcn/disclosure'
import { ContextActionMenu } from '@sim/emcn/menu/action-menu'
import { usePathname, useSearchParams } from 'next/navigation'
import type { ShellData, ShellWorkspace } from '@/platform/app/(shell)/_components/model'
import { linkMenuActions } from '@/platform/app/(shell)/_components/sidebar/row-links'
import { workspaceNavigation } from '@/platform/app/(shell)/_components/workspace-navigation/destinations'
import styles from '@/platform/app/(shell)/_components/workspace-navigation/workspace-navigation.module.css'
import { platformHref } from '@/platform/lib/navigation'
import type { workspaceLocation } from '@/platform/lib/workspace-navigation'
import type { ShellDestination } from '@/platform/shared/shell'

interface WorkspaceNavigationProps {
  chats?: ReactNode
  workspace?: ShellWorkspace
  unbacked?: ShellData['unbacked']
  location: NonNullable<ReturnType<typeof workspaceLocation>>
}

export function WorkspaceNavigation({
  workspace,
  location,
  chats,
  unbacked,
}: WorkspaceNavigationProps) {
  const search = useSearchParams()
  const pathname = usePathname()
  const items = workspaceNavigation(location.id, workspace?.workflows, unbacked)
  const folders = [...new Set(items.workflows.flatMap(({ folder }) => (folder ? [folder] : [])))]
  function row(item: ShellDestination) {
    const href = platformHref(item.value, search)
    return (
      <ContextActionMenu
        key={item.id}
        label={`Actions for ${item.label}`}
        actions={linkMenuActions(href)}
      >
        <Chip
          href={href}
          icon={item.icon}
          selected={
            pathname === item.value ||
            (item.id !== 'new-chat' && pathname.startsWith(`${item.value}/`))
          }
        >
          {item.label}
        </Chip>
      </ContextActionMenu>
    )
  }
  return (
    <nav className={styles.nav} aria-label={`${workspace?.name ?? 'Workspace'} navigation`}>
      <div className={styles.rows}>{items.primary.map(row)}</div>
      {chats}
      <Disclosure variant='navigation' label='Workspace' initiallyOpen>
        <div className={styles.rows}>{items.pages.map(row)}</div>
      </Disclosure>
      <Disclosure variant='navigation' label='Workflows' initiallyOpen>
        <div className={styles.rows}>
          {items.workflows.filter((item) => !item.folder).map(row)}
          {folders.map((folder) => (
            <Disclosure key={folder} variant='folder' label={folder} initiallyOpen>
              <div className={styles.nested}>
                {items.workflows.filter((item) => item.folder === folder).map(row)}
              </div>
            </Disclosure>
          ))}
          {!items.workflows.length && (
            <span className={styles.empty} data-type='T052'>
              No workflows yet
            </span>
          )}
        </div>
      </Disclosure>
    </nav>
  )
}
