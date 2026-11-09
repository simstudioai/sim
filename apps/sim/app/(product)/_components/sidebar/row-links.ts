import type { MenuAction } from '@sim/emcn/menu/action-menu'
import { isAbsoluteHref, publicAssetPath } from '@/platform/lib/navigation'
import { createRowLinks } from '@/platform/shared/row-links'

const links = createRowLinks((href) => (isAbsoluteHref(href) ? href : publicAssetPath(href)))

export const { openLinkInNewTab, openInNewTabAction } = links

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
  return [openInNewTabAction(href), links.copyLinkAction(href)]
}
