import { cn } from '@/lib/core/utils/cn'
import { getGitHubStars } from '@/lib/github/stars'
import styles from '@/app/(landing)/brand-tokens.module.css'
import { Cta, Features, Footer, Hero, Mothership, Navbar } from '@/app/(landing)/components'

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
    <div
      className={cn(
        'light h-screen overflow-y-auto overscroll-y-none bg-[var(--bg)] text-[var(--text-primary)]',
        styles.brand
      )}
    >
      <a
        href='#main-content'
        className='sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[var(--z-toast)] focus:rounded-md focus:bg-[var(--surface-2)] focus:px-4 focus:py-2 focus:text-[var(--text-primary)] focus:text-sm'
      >
        Skip to main content
      </a>
      <Navbar stars={stars} />
      <main id='main-content' className='flex flex-col gap-[120px] max-sm:gap-16 max-lg:gap-[88px]'>
        <Hero />
        <Mothership />
        <Features />
        <Cta />
      </main>
      <Footer />

      {/* Bottom reveal — a short, soft white-fade + blur pinned to the viewport's
          lower edge so content emerges into clarity as it scrolls up. Two
          decorative layers: the blur fades out via a mask, the white tints over
          it. */}
      <div
        aria-hidden='true'
        className='pointer-events-none fixed inset-x-0 bottom-0 z-40 h-16 backdrop-blur-[2px] [-webkit-mask-image:linear-gradient(to_top,black,transparent)] [mask-image:linear-gradient(to_top,black,transparent)]'
      />
      <div
        aria-hidden='true'
        className='pointer-events-none fixed inset-x-0 bottom-0 z-40 h-16 bg-gradient-to-t from-[var(--bg)] to-transparent'
      />
    </div>
  )
}
