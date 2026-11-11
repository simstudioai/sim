import type { MouseEvent } from 'react'
import { openInBrowserPanel, shouldOpenInBrowserPanel } from '@/lib/browser-agent/open-in-panel'
import { siteHost } from '@/lib/favicon/url'

/** The site a link belongs to: its known site name, else its hostname without `www.`. */
export function linkSiteName(url: string, siteName?: string | null): string {
  return siteName?.trim() || (siteHost(url) ?? url).replace(/^www\./, '')
}

/**
 * A prose link shares the platform blue and retains a visible keyboard focus outline.
 */
export const PROSE_LINK_CLASS =
  'not-prose [&_strong]:text-inherit [&_em]:text-inherit [&_code]:text-inherit [&_del]:text-inherit text-[var(--brand-blue)] no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text-primary)]'

/**
 * In the desktop app, a plain click diverts into the embedded Sim browser
 * panel; modified clicks (Cmd/Ctrl/Shift/middle) keep the default behavior,
 * which the shell routes to the system browser. In a web browser this is a
 * no-op and the link opens a new tab as usual.
 */
export function handleExternalLinkClick(event: MouseEvent<HTMLAnchorElement>, href: string): void {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
  if (!shouldOpenInBrowserPanel(href)) return
  event.preventDefault()
  openInBrowserPanel(href)
}
