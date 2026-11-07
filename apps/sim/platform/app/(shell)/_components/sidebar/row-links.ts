import type { MenuAction } from '@sim/emcn/menu/action-menu'
import { toast } from '@/platform/lib/data/toast'
import { isAbsoluteHref, publicAssetPath } from '@/platform/lib/navigation'

/** The browser adds no base path for a new tab or the clipboard, unlike `next/link`. */
function absoluteHref(href: string): string {
  return new URL(isAbsoluteHref(href) ? href : publicAssetPath(href), window.location.origin).href
}

async function copyLink(href: string) {
  try {
    await navigator.clipboard.writeText(absoluteHref(href))
  } catch {
    toast.error('Failed to copy link')
  }
}

export function openLinkInNewTab(href: string) {
  window.open(absoluteHref(href), '_blank', 'noopener,noreferrer')
}

export function openInNewTabAction(href: string): MenuAction {
  return {
    id: 'open-new-tab',
    label: 'Open in new tab',
    icon: 'I037',
    onSelect: () => openLinkInNewTab(href),
  }
}

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
  return [
    openInNewTabAction(href),
    { id: 'copy-link', label: 'Copy link', icon: 'I006', onSelect: () => void copyLink(href) },
  ]
}

/** A form dialog's text field, trimmed. */
export function readFormText(values: FormData, name: string): string {
  const value = values.get(name)
  return typeof value === 'string' ? value.trim() : ''
}
