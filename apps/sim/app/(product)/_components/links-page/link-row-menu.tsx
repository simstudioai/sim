'use client'

import { type MouseEvent, type ReactNode, type TouchEvent, useState } from 'react'
import type { MenuAction } from '@sim/emcn/menu/action-menu'
import { ContextActionMenu } from '@sim/emcn/menu/action-menu'
import { type LinkRecord, openLink } from '@/platform/lib/data/links'

/** The row's actions. `canEdit` gates both changes; `canManage` only gates the editor's Access. */
export function linkActions(
  link: LinkRecord,
  { onCopy, onEdit, onDelete }: RowActions
): readonly MenuAction[] {
  return [
    { id: 'open', label: 'Open', icon: 'I030', onSelect: () => openLink(link.name) },
    { id: 'copy', label: 'Copy link', icon: 'I006', onSelect: () => void onCopy(link.name) },
    ...(link.canEdit
      ? ([
          { id: 'edit', label: 'Edit', icon: 'I036', onSelect: () => onEdit(link) },
          {
            id: 'delete',
            label: 'Delete',
            icon: 'I061',
            destructive: true,
            separatorBefore: true,
            onSelect: () => onDelete(link),
          },
        ] satisfies MenuAction[])
      : []),
  ]
}

export interface RowActions {
  onCopy: (name: string) => Promise<void>
  onEdit: (link: LinkRecord) => void
  onDelete: (link: LinkRecord) => void
}

interface LinkRowContextMenuProps extends RowActions {
  links: readonly LinkRecord[]
  children: ReactNode
}

/**
 * One context menu serves the whole table, so the row under the pointer decides its actions. Off a
 * row, the event stops here: the browser keeps its own menu, as it does for a touch and hold. The
 * selection lives here so a touch on the table does not re-render its rows.
 */
export function LinkRowContextMenu({ links, children, ...actions }: LinkRowContextMenuProps) {
  const [menuLinkId, setMenuLinkId] = useState<string | null>(null)
  const menuLink = links.find((link) => link.id === menuLinkId)

  const selectRowUnderPointer = (event: MouseEvent<HTMLElement> | TouchEvent<HTMLElement>) => {
    const row =
      event.target instanceof Element ? event.target.closest<HTMLElement>('tr[data-index]') : null
    const link = row ? links[Number(row.dataset.index)] : undefined
    if (link) setMenuLinkId(link.id)
    else event.stopPropagation()
  }

  return (
    <div onContextMenuCapture={selectRowUnderPointer} onTouchStartCapture={selectRowUnderPointer}>
      <ContextActionMenu
        label='Link actions'
        actions={menuLink ? linkActions(menuLink, actions) : []}
      >
        {children}
      </ContextActionMenu>
    </div>
  )
}
