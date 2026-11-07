import type { MenuAction } from '@sim/emcn/menu/action-menu'
import { toast } from '@/platform/shared/toast'

/**
 * Row actions for a link. `resolveHref` supplies what the browser will not add for a new tab or the
 * clipboard, unlike `next/link`, such as the zone's base path.
 */
export function createRowLinks(resolveHref: (href: string) => string = (href) => href) {
  const absoluteHref = (href: string) => new URL(resolveHref(href), window.location.origin).href

  const openLinkInNewTab = (href: string) => {
    window.open(absoluteHref(href), '_blank', 'noopener,noreferrer')
  }

  const copyLink = async (href: string) => {
    try {
      await navigator.clipboard.writeText(absoluteHref(href))
    } catch {
      toast.error('Failed to copy link')
    }
  }

  const openInNewTabAction = (href: string): MenuAction => ({
    id: 'open-new-tab',
    label: 'Open in new tab',
    icon: 'I037',
    onSelect: () => openLinkInNewTab(href),
  })

  const copyLinkAction = (href: string): MenuAction => ({
    id: 'copy-link',
    label: 'Copy link',
    icon: 'I006',
    onSelect: () => void copyLink(href),
  })

  return { openLinkInNewTab, openInNewTabAction, copyLinkAction }
}

/** A form dialog's text field, trimmed. */
export function readFormText(values: FormData, name: string): string {
  const value = values.get(name)
  return typeof value === 'string' ? value.trim() : ''
}
