import { getGitHubStars } from '@/lib/github/stars'
import { Features, Footer, Hero, Lifecycle, Navbar } from '@/app/(landing)/components'

/**
 * Landing page root — owns section order and server-side context.
 *
 * Section components are stubs until each is defined; read
 * `app/(landing)/CLAUDE.md` before implementing any of them.
 *
 * - Statically rendered (`revalidate` in `page.tsx`); all server-side
 *   context (GitHub stars) is fetched here at build/revalidate time and
 *   passed down as props — no client fetching for above-fold content.
 * - The `light` wrapper pins every `var(--*)` design token to its
 *   light-mode value regardless of the visitor's theme preference; the
 *   landing page is always light.
 * - This wrapper is also the page's scroll port (`h-screen` +
 *   `overflow-y-auto` + `overscroll-y-none`): the document body no longer
 *   overflows, so the viewport can't rubber-band, and the container's own
 *   overscroll bounce is disabled. Without this the sticky navbar gets
 *   dragged past the top/bottom edges on overscroll.
 * - Each section component owns its landmark: Navbar renders `<header>`,
 *   Footer renders `<footer>`, sections render `<section id aria-labelledby>`.
 * - `<main>` is a `flex flex-col` whose `gap` is the single source of truth for
 *   inter-section rhythm — sections carry no vertical margin/padding of their
 *   own, so one knob keeps every section break uniform across the page.
 */
export default async function Landing() {
  const stars = await getGitHubStars()

  return (
    <div className='light h-screen overflow-y-auto overscroll-y-none bg-[var(--bg)] text-[var(--text-primary)]'>
      <a
        href='#main-content'
        className='sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[var(--z-toast)] focus:rounded-md focus:bg-[var(--surface-2)] focus:px-4 focus:py-2 focus:text-[var(--text-primary)] focus:text-sm'
      >
        Skip to main content
      </a>
      <Navbar stars={stars} />
      <main id='main-content' className='flex flex-col gap-[120px]'>
        <Hero />
        <Lifecycle />
        <Features />
        {/* <Testimonials /> */}
      </main>
      <Footer />
    </div>
  )
}
