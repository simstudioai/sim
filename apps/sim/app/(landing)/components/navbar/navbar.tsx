import Link from 'next/link'
import { ChipLink } from '@/components/emcn'
import { GitHubChip } from '@/app/(landing)/components/navbar/components/github-chip'
import { LogoMark } from '@/app/(landing)/components/navbar/components/logo-mark'
import { MobileNav } from '@/app/(landing)/components/navbar/components/mobile-nav'
import { NavMenuChip } from '@/app/(landing)/components/navbar/components/nav-menu-chip'
import { NavbarShell } from '@/app/(landing)/components/navbar/components/navbar-shell'
import { SimWordmark } from '@/app/(landing)/components/navbar/components/sim-wordmark'

/**
 * Landing navbar.
 *
 * Sticky `<header><nav>` landmark with `SiteNavigationElement` schema.org
 * markup. Server Component — the dropdown triggers, GitHub chip, and the
 * {@link NavbarShell} (which frosts the bar to glass on scroll) are isolated
 * client leaves, so the wordmark and links stay zero-hydration, crawlable HTML.
 *
 * Every item is a bare emcn chip. Both clusters use `gap-1`, which with
 * the chips' own `mx-0.5` margins yields 8px between pills; the nav's
 * `gap-3.5` (14px) plus the first chip's 2px margin puts exactly 16px —
 * twice the inter-chip gap — between the wordmark and the Platform chip.
 * Horizontal padding (`px-12`, 48px) matches every section's edge gutter,
 * and the bar content is capped and centered at the shared
 * `max-w-[1446px]` (1350px content + the two 48px gutters) so the wordmark
 * aligns with the contained section content on wide screens — the frosted
 * `<header>` shell stays full-bleed. Slightly taller vertical padding. Text
 * weight is the platform default (400).
 *
 * Layout (left → right): Sim wordmark (18px glyph centered in a
 * chip-height slot, chip-text color) → Platform / Resources / Solutions
 * (hover dropdowns, TBD) → Pricing → GitHub stars. Right side: Log in
 * (default chip), Contact sales (outline chip), Sign up (filled chip).
 */

interface NavbarProps {
  /** Formatted GitHub star count (e.g. "28.8k"), fetched server-side at build/revalidate time. */
  stars: string
}

export function Navbar({ stars }: NavbarProps) {
  return (
    <NavbarShell>
      <nav
        aria-label='Primary navigation'
        itemScope
        itemType='https://schema.org/SiteNavigationElement'
        className='relative mx-auto flex w-full max-w-[1446px] items-center gap-3.5 px-12 py-4 max-sm:px-5 max-lg:px-8'
      >
        <Link href='/' aria-label='Sim home' itemProp='url' className='flex h-[30px] items-center'>
          <span itemProp='name' className='sr-only'>
            Sim
          </span>
          <LogoMark>
            <SimWordmark />
          </LogoMark>
        </Link>

        <div className='hidden items-center gap-1 lg:flex'>
          <NavMenuChip label='Platform' />
          <NavMenuChip label='Resources' />
          <NavMenuChip label='Solutions' />
          <ChipLink href='/pricing' itemProp='url'>
            Pricing
          </ChipLink>
          <GitHubChip stars={stars} />
        </div>

        <div className='ml-auto hidden items-center gap-1 lg:flex'>
          <ChipLink href='/login'>Log in</ChipLink>
          <ChipLink href='/contact' className='border border-[var(--border-1)]'>
            Contact sales
          </ChipLink>
          <ChipLink variant='primary' href='/signup'>
            Sign up
          </ChipLink>
        </div>

        <MobileNav stars={stars} />
      </nav>
    </NavbarShell>
  )
}
