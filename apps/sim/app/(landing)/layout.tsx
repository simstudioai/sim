import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { isHosted } from '@/lib/core/config/env-flags'
import { SITE_URL } from '@/lib/core/utils/urls'
import { LandingShell } from '@/app/(landing)/components'
import { LandingConsentTracking } from '@/app/(landing)/landing-consent-tracking'

/**
 * Shared layout for all public marketing routes, including platform, solutions,
 * pricing, editorial, catalog, demo, and legal pages. LandingShell owns the
 * persistent navbar, painted CTA, footer, and site-wide structured data.
 * Pages supply their main content and page-specific metadata only.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
}

export default function LandingLayout({ children }: { children: ReactNode }) {
  return (
    <LandingShell>
      {children}
      {isHosted && <LandingConsentTracking />}
    </LandingShell>
  )
}
