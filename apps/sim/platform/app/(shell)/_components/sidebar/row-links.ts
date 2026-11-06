import type { MenuAction } from '@/platform/design-system/components/menu/action-menu'
import { isAbsoluteHref, publicAssetPath } from '@/platform/design-system/navigation'
import { createRowLinks } from '@/platform/shared/row-links'

export const { openLinkInNewTab, openInNewTabAction, copyLinkAction } = createRowLinks((href) =>
  isAbsoluteHref(href) ? href : publicAssetPath(href)
)

export function linkMenuActions(href: string): MenuAction[] {
  return [openInNewTabAction(href), copyLinkAction(href)]
}
