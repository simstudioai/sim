import type { ReactNode } from 'react'
import { isHosted } from '@/lib/core/config/env-flags'
import { getGitHubStars } from '@/lib/github/stars'
import { Cta } from '@/app/(landing)/components/cta/cta'
import { Footer } from '@/app/(landing)/components/footer/footer'
import { Navbar } from '@/app/(landing)/components/navbar/navbar'
import { SiteStructuredData } from '@/app/(landing)/components/site-structured-data'

/**
 * Persistent marketing chrome, mounted once by the landing route-group layout.
 * Every page supplies its main content; this shell owns the themed scroll port,
 * navigation, painted pre-footer CTA, footer, and site-wide structured data.
 * Positioning the scroll port contains absolute artwork within its overflow,
 * preventing an outer document scroll from carrying the sticky header away.
 * The closing group keeps the same responsive separation on every route.
 */

interface LandingShellProps {
  /** The page's `<main id='main-content'>` region - the only content the shell wraps. */
  children: ReactNode
}

export async function LandingShell({ children }: LandingShellProps) {
  const stars = await getGitHubStars()

  return (
    <div className='relative h-screen overflow-y-auto overscroll-y-none bg-[var(--bg)] text-[var(--text-primary)] [--text-muted:var(--text-secondary)]'>
      <SiteStructuredData />
      <a
        href='#main-content'
        className='sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[var(--z-toast)] focus:rounded-md focus:bg-[var(--surface-2)] focus:px-4 focus:py-2 focus:text-[var(--text-primary)] focus:text-sm'
      >
        Skip to main content
      </a>
      <Navbar stars={stars} />
      {children}
      <div className='pt-36 max-sm:pt-20 max-lg:pt-24'>
        <Cta />
        <Footer showConsentPreferences={isHosted} />
      </div>
    </div>
  )
}
