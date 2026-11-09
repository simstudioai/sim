import type { Metadata, Viewport } from 'next'
import { SITE_VIEWPORT, SiteRootLayout } from '@/app/_shell/site-root-layout'
import { SITE_GLOBAL_NOT_FOUND_METADATA, SiteNotFound } from '@/app/_shell/status-not-found'

export const viewport: Viewport = SITE_VIEWPORT

export const metadata: Metadata = SITE_GLOBAL_NOT_FOUND_METADATA

/**
 * Unmatched URLs: the app has several root layouts, so no single one can compose
 * this page. `site-root-layout` sorts before `status-not-found`, which keeps the
 * site stylesheet ahead of the page's CSS modules, as under a root layout.
 */
export default function GlobalNotFound() {
  return (
    <SiteRootLayout>
      <SiteNotFound />
    </SiteRootLayout>
  )
}
