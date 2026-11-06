import type { MenuAction } from '@/platform/design-system/components/menu/action-menu'
import { isAbsoluteHref, publicAssetPath } from '@/platform/design-system/navigation'
import { createRowLinks } from '@/platform/shared/row-links'

const links = createRowLinks((href) => (isAbsoluteHref(href) ? href : publicAssetPath(href)))

export const { openLinkInNewTab, openInNewTabAction } = links

export function linkMenuActions(href: string): MenuAction[] {
  return [openInNewTabAction(href), links.copyLinkAction(href)]
}
