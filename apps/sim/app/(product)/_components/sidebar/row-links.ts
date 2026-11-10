import type { MenuAction } from '@sim/emcn/menu/action-menu'
import { copyLinkAction, openInNewTabAction } from '@/platform/shared/row-links'

export function pinAction(
  item: { id: string; isPinned?: boolean },
  setPinned: (id: string, pinned: boolean) => void
): MenuAction {
  return {
    id: 'pin',
    label: item.isPinned ? 'Unpin' : 'Pin',
    icon: 'I131',
    onSelect: () => setPinned(item.id, !item.isPinned),
  }
}

export function linkMenuActions(href: string): MenuAction[] {
  return [openInNewTabAction(href), copyLinkAction(href)]
}
