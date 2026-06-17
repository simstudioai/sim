import type { ReactNode } from 'react'
import { cn } from '@/lib/core/utils/cn'
import { getGitHubStars } from '@/lib/github/stars'
import { Footer } from '@/app/(landing)/components/footer/footer'
import { Navbar } from '@/app/(landing)/components/navbar/navbar'

/**
 * The shared chrome every landing-family page wears — the home page, every
 * platform page (Workflows, Tables, Files, …), and every solutions page (IT,
 * Engineering, …). It is the single source of truth for the page frame, so each
 * page is just `<LandingShell>{content}</LandingShell>` and can never drift.
 *
 * It owns:
 * - The `light` wrapper, which pins every `var(--*)` design token to its
 *   light-mode value regardless of the visitor's theme — the landing family is
 *   always light — plus the {@link BRAND_TOKENS} palette, which remaps those
 *   tokens to the SIM brand neutrals for the whole subtree.
 * - The page's scroll port (`h-screen` + `overflow-y-auto` +
 *   `overscroll-y-none`): the document body no longer overflows, so the viewport
 *   can't rubber-band, and the container's own overscroll bounce is disabled —
 *   without this the sticky navbar gets dragged past the top/bottom edges.
 * - The skip link (targets `#main-content`), the {@link Navbar} (GitHub stars
 *   fetched here at build/revalidate time — never client-fetched), the
 *   {@link Footer}, and the bottom reveal (a soft white-fade + blur pinned to
 *   the viewport's lower edge so content emerges into clarity as it scrolls up).
 *
 * The page supplies only the `<main id='main-content'>` content between the
 * navbar and footer. Async Server Component; pages render it with zero props.
 */

interface LandingShellProps {
  /** The page's `<main id='main-content'>` region — the only content the shell wraps. */
  children: ReactNode
}

/**
 * The SIM brand palette — remaps the platform's light-mode tokens (`--bg`,
 * `--surface-*`, `--text-*`, `--border*`) to the brand neutrals for the whole
 * landing subtree. Written as Tailwind arbitrary-property utilities so the brand
 * hex lives in this one component (not a stylesheet); because they emit in the
 * `utilities` layer they override the `.light` definitions (`@layer base`)
 * regardless of selector specificity. Every (landing) component then picks up
 * brand color through the `var(--*)` tokens it already reads — no per-component edits.
 */
const BRAND_TOKENS =
  '[--bg:#ffffff] [--surface-1:#f8f8f8] [--surface-2:#ffffff] [--surface-3:#f8f8f8] [--surface-4:#f8f8f8] [--surface-5:#f8f8f8] [--surface-6:#e6e6e6] [--surface-7:#c3c3c3] [--border:#e6e6e6] [--border-1:#e6e6e6] [--text-primary:#121212] [--text-secondary:#5f5f5f] [--text-body:#2c2c2c] [--text-muted:#5f5f5f] [--text-icon:#5f5f5f] [--text-inverse:#e6e6e6] [--text-subtle:#b4b4b4]'

export async function LandingShell({ children }: LandingShellProps) {
  const stars = await getGitHubStars()

  return (
    <div
      className={cn(
        'light h-screen overflow-y-auto overscroll-y-none bg-[var(--bg)] text-[var(--text-primary)]',
        BRAND_TOKENS
      )}
    >
      <a
        href='#main-content'
        className='sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[var(--z-toast)] focus:rounded-md focus:bg-[var(--surface-2)] focus:px-4 focus:py-2 focus:text-[var(--text-primary)] focus:text-sm'
      >
        Skip to main content
      </a>
      <Navbar stars={stars} />
      {children}
      <Footer />

      {/* Bottom reveal — a short, soft white-fade + blur pinned to the viewport's
          lower edge so content emerges into clarity as it scrolls up. Two
          decorative layers: the blur fades out via a mask, the white tints over it. */}
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
