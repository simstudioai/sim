import { toast } from '@sim/emcn'
import type { MenuAction } from '@/platform/design-system/components/menu/action-menu'

function absoluteHref(href: string): string {
  return new URL(href, window.location.origin).href
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

export function copyLinkAction(href: string): MenuAction {
  return { id: 'copy-link', label: 'Copy link', icon: 'I006', onSelect: () => void copyLink(href) }
}

/** A form dialog's text field, trimmed. */
export function readFormText(values: FormData, name: string): string {
  const value = values.get(name)
  return typeof value === 'string' ? value.trim() : ''
}
