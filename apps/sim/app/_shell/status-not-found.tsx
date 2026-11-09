import { StatusPageContent } from '@sim/emcn-legacy'
import type { Metadata } from 'next'
import { ReturnHomeLink } from '@/components/status-page/return-home-link'
import { LogoShell } from '@/app/(landing)/components/logo-shell'
import { generateBrandedMetadata, getBrandConfig } from '@/ee/whitelabeling'

const SITE_NOT_FOUND_TITLE = 'Page Not Found'

/** Metadata for the site-wide not-found page; each `not-found.tsx` that renders it exports this. */
export const SITE_NOT_FOUND_METADATA: Metadata = {
  title: SITE_NOT_FOUND_TITLE,
  robots: { index: false, follow: true },
}

/**
 * The same page metadata as one layer that also carries the site branding, for
 * `global-not-found.tsx`, which renders outside every layout. The branded title
 * template only applies to child layers, so the title is composed here.
 */
export const SITE_GLOBAL_NOT_FOUND_METADATA: Metadata = generateBrandedMetadata({
  ...SITE_NOT_FOUND_METADATA,
  title: `${SITE_NOT_FOUND_TITLE} | ${getBrandConfig().name}`,
})

/** The site-wide not-found page, rendered directly inside a site root layout. */
export function SiteNotFound() {
  return (
    <LogoShell center theme='inherit'>
      <StatusPageContent
        title='Page not found'
        description="The page you're looking for doesn't exist or has been moved."
      >
        <ReturnHomeLink />
      </StatusPageContent>
    </LogoShell>
  )
}
