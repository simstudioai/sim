import type { ReactNode } from 'react'
import { getGitHubStars } from '@/lib/github/stars'
import { Footer } from '@/app/(landing)/components/footer/footer'
import { Navbar } from '@/app/(landing)/components/navbar/navbar'
import { SiteStructuredData } from '@/app/(landing)/components/site-structured-data'

/**
 * The shared chrome every landing-family page wears - the home page, every
 * platform page (Workflows, Tables, Files, …), and every solutions page (IT,
 * Engineering, …). It is the single source of truth for the page frame, so each
 * page is just `<LandingShell>{content}</LandingShell>` and can never drift.
 *
 * It owns:
 * - The `light` wrapper, which pins every `var(--*)` design token to its
 *   light-mode value regardless of the visitor's theme - the landing family is
 *   always light, and uses the platform's own light-mode tokens (from
 *   `globals.css`) with no separate palette.
 * - The page's traffic-light-safe scroll port (`desktop-title-bar-page-height`
 *   + `overflow-y-auto` +
 *   `overscroll-y-none`): the document body no longer overflows, so the viewport
 *   can't rubber-band, and the container's own overscroll bounce is disabled -
 *   without this the sticky navbar gets dragged past the top/bottom edges.
 * - The skip link (targets `#main-content`), the {@link Navbar} (GitHub stars
 *   fetched here at build/revalidate time - never client-fetched), and the
 *   {@link Footer}.
 *
 * The page supplies only the `<main id='main-content'>` content between the
 * navbar and footer. Async Server Component; pages render it with zero props.
 */

interface LandingShellProps {
  /** The page's `<main id='main-content'>` region - the only content the shell wraps. */
  children: ReactNode
}

export async function LandingShell({ children }: LandingShellProps) {
  const stars = await getGitHubStars()

  return (
    <div className='desktop-title-bar-page-height light overflow-y-auto overscroll-y-none bg-[var(--bg)] text-[var(--text-primary)]'>
      <SiteStructuredData />
      <a
        href='#main-content'
        className='sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[var(--z-toast)] focus:rounded-md focus:bg-[var(--surface-2)] focus:px-4 focus:py-2 focus:text-[var(--text-primary)] focus:text-sm'
      >
        Skip to main content
      </a>
      <Navbar stars={stars} />
      {children}
      <Footer />
    </div>
  )
}
