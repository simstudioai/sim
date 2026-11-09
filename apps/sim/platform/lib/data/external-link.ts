'use client'

import type { MouseEvent } from 'react'
import { handleExternalLinkClick } from '@/lib/mothership/chat/source-link'

/**
 * A chat link's click. In the desktop app, with a chat panel mounted, a plain click opens the page
 * in the panel's browser tab; modified clicks and the web browser keep the link's own behavior.
 */
export function onExternalLinkClick(
  event: MouseEvent<HTMLAnchorElement>,
  href: string | undefined
) {
  if (href) handleExternalLinkClick(event, href)
}
