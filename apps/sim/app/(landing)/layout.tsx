import type { ReactNode } from 'react'
import { Suspense } from 'react'
import type { Metadata } from 'next'
import Script from 'next/script'
import { isHosted } from '@/lib/core/config/env-flags'
import { SITE_URL } from '@/lib/core/utils/urls'
import { LandingShell } from '@/app/(landing)/components'
import { HubspotPageViewTracker } from '@/app/(landing)/hubspot-page-view-tracker'
import { XPageViewTracker } from '@/app/(landing)/x-page-view-tracker'

const HUBSPOT_SCRIPT_SRC = 'https://js-na2.hs-scripts.com/246720681.js' as const

const X_PIXEL_ID = 'q5xbl' as const
const isMarketingAnalyticsEnabled = isHosted && !process.env.E2E_PROFILE

/** X (Twitter) conversion tracking base code — loads uwt.js and fires the initial PageView. */
const X_PIXEL_BASE_CODE = `!function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);
},s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',
a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');
twq('config','${X_PIXEL_ID}');`

/**
 * Route-group layout for the entire landing family - the home page, platform and
 * solutions pages, pricing, legal, and the marketing subroutes (blog, models,
 * integrations, partners).
 *
 * It renders the shared chrome **once** via {@link LandingShell} (the `light`
 * token layer + scroll port, the skip link, the {@link Navbar} with
 * build/revalidate-time GitHub stars, the site-wide JSON-LD, and the
 * {@link Footer}). Because layouts persist across client navigations, the navbar
 * and footer mount once and are never torn down when moving between landing
 * pages - no remount, no refetch, no flash.
 *
 * Each page supplies only its `<main id='main-content'>` content (and any
 * page-specific metadata / JSON-LD). `metadataBase` here lets pages express
 * relative canonical/OG URLs; every other metadata field stays per-page.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
}

export default function LandingLayout({ children }: { children: ReactNode }) {
  return (
    <LandingShell>
      {children}
      {/* HubSpot + X pixel tracking — hosted only */}
      {isMarketingAnalyticsEnabled && (
        <>
          <Script id='hs-script-loader' src={HUBSPOT_SCRIPT_SRC} strategy='afterInteractive' />
          <Script id='x-pixel-base' strategy='afterInteractive'>
            {X_PIXEL_BASE_CODE}
          </Script>
          <Suspense fallback={null}>
            <HubspotPageViewTracker />
            <XPageViewTracker />
          </Suspense>
        </>
      )}
    </LandingShell>
  )
}
