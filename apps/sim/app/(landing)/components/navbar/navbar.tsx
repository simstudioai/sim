import { ChipLink } from '@sim/emcn'
import Link from 'next/link'
import {
  GitHubChip,
  LogoMark,
  MobileNav,
  NAV_MENUS,
  NavbarShell,
  NavMenuChip,
  SimWordmark,
} from '@/app/(landing)/components/navbar/components'
import { DEMO_HREF, SIGNUP_HREF } from '@/app/(landing)/constants'

/**
 * Landing navbar.
 *
 * Sticky `<header><nav>` landmark with `SiteNavigationElement` schema.org
 * markup. Server Component - the dropdown triggers, GitHub chip, and the
 * {@link NavbarShell} (which frosts the bar to glass on scroll) are isolated
 * client leaves, so the wordmark and links stay zero-hydration, crawlable HTML.
 *
 * Every item is a bare emcn chip. Both clusters use `gap-1`, which with
 * the chips' own `mx-0.5` margins yields 8px between pills; the nav's
 * `gap-3.5` (14px) plus the first chip's 2px margin puts exactly 16px -
 * twice the inter-chip gap - between the wordmark and the first menu chip.
 * Horizontal padding (`px-20`, 48px) matches every section's edge gutter,
 * and the bar content is capped and centered at the shared
 * `max-w-[1460px]` (1300px content + the two 80px gutters) so the wordmark
 * aligns with the contained section content on wide screens - the frosted
 * `<header>` shell stays full-bleed. Slightly taller vertical padding. Text
 * weight is the platform default (400).
 *
 * Layout (left → right): Sim wordmark (18px glyph centered in a
 * chip-height slot, chip-text color) → the {@link NAV_MENUS} mega-menus
 * (pure-CSS hover/focus dropdowns) → Pricing → GitHub stars. Right side: Log in
 * (default chip), Contact sales (outline chip), Sign up (filled chip).
 */

interface NavbarProps {
  /**
   * Formatted GitHub star count (e.g. "28.8k"), fetched server-side at
   * build/revalidate time. Omitted by non-marketing shells that reuse this
   * navbar without a stars fetch (the GitHub chip is hidden when absent).
   */
  stars?: string
  /**
   * Render only the Sim wordmark - no nav menus, GitHub chip, auth chips, or
   * mobile sheet. Used by non-marketing shells (resume, public-file auth) that
   * want the brand header without the full marketing navigation.
   */
  logoOnly?: boolean
}

export function Navbar({ stars, logoOnly = false }: NavbarProps) {
  return (
    <NavbarShell>
      <nav
        aria-label='Primary navigation'
        itemScope
        itemType='https://schema.org/SiteNavigationElement'
        className='relative mx-auto flex w-full max-w-[1460px] items-center gap-3.5 px-20 py-4 max-sm:px-5 max-lg:px-8'
      >
        <Link href='/' aria-label='Sim home' itemProp='url' className='flex h-[30px] items-center'>
          <span itemProp='name' className='sr-only'>
            Sim
          </span>
          <LogoMark>
            <SimWordmark />
          </LogoMark>
        </Link>

        {!logoOnly && (
          <>
            <div className='hidden items-center gap-1 lg:flex'>
              {NAV_MENUS.map((menu) => (
                <NavMenuChip key={menu.label} menu={menu} />
              ))}
              <ChipLink href='/enterprise' itemProp='url'>
                Enterprise
              </ChipLink>
              <ChipLink href='/pricing' itemProp='url'>
                Pricing
              </ChipLink>
              {stars !== undefined && <GitHubChip stars={stars} />}
            </div>

            <div className='ml-auto hidden items-center gap-1 lg:flex'>
              <ChipLink href='/login' prefetch={false}>
                Log in
              </ChipLink>
              <ChipLink variant='border' href={DEMO_HREF}>
                Contact sales
              </ChipLink>
              <ChipLink variant='primary' href={SIGNUP_HREF} prefetch={false}>
                Sign up
              </ChipLink>
            </div>

            <MobileNav stars={stars ?? '0'} />
          </>
        )}
      </nav>
    </NavbarShell>
  )
}
