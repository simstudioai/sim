import type { MenuAction } from '@/platform/design-system/components/menu/action-menu'
import { publicAssetPath } from '@/platform/design-system/navigation'
import { toast } from '@/platform/lib/data/toast'

/** A route on the legacy surface, named by its absolute URL. Next's router must not handle it. */
export const LEGACY_DESTINATION = /^https?:\/\//

/** The browser adds no base path for a new tab or the clipboard, unlike `next/link`. */
function absoluteHref(href: string): string {
  return new URL(
    LEGACY_DESTINATION.test(href) ? href : publicAssetPath(href),
    window.location.origin
  ).href
}

async function copyLink(href: string) {
  try {
    await navigator.clipboard.writeText(absoluteHref(href))
  } catch {
    toast.error('Failed to copy link')
  }
}

function openLinkInNewTab(href: string) {
  window.open(absoluteHref(href), '_blank', 'noopener,noreferrer')
}

export function linkMenuActions(href: string): MenuAction[] {
  return [
    {
      id: 'open-new-tab',
      label: 'Open in new tab',
      icon: 'I037',
      onSelect: () => openLinkInNewTab(href),
    },
    { id: 'copy-link', label: 'Copy link', icon: 'I006', onSelect: () => void copyLink(href) },
  ]
}
